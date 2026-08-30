import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `isErrorResponse` keeps its real shape (a plain predicate, not a vi.fn())
// so the mock survives strict typing at the call site the same way
// `plugins/routes/dispatch-auth.test.ts` does -- casting a type-predicate
// import to `ReturnType<typeof vi.fn>` does not type-check.
vi.mock("../auth/middleware", () => ({
  requireAuthentication: vi.fn(),
  isErrorResponse: (x: unknown) =>
    !!x && typeof x === "object" && "statusCode" in x,
}));
vi.mock("../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: vi.fn((e: unknown) => new Error(String(e))),
}));
vi.mock("../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));

// `vi.hoisted` (rather than a bare top-level `const`) so these survive
// Vitest hoisting `vi.mock` calls above every other statement in the file --
// a bare const referenced inside a factory below its own declaration is a
// TDZ access at the point the hoisted mock runs.
const { executeWidgetQuery } = vi.hoisted(() => ({
  executeWidgetQuery: vi.fn(),
}));
vi.mock("../domains/widgets/execute", () => ({ executeWidgetQuery }));

// `readCaller` resolves role slugs from the database. Mocked so this handler
// test exercises the batching and error isolation, not the auth stack.
const { readCaller } = vi.hoisted(() => ({ readCaller: vi.fn() }));
vi.mock("./authenticated-read", () => ({
  readCaller,
  readAccessCaller: (caller: { user: { id: string } }) => ({
    userId: caller.user.id,
    authMethod: "session" as const,
    permissions: [],
    roles: [],
  }),
}));

// The collection registry is reached through the DI container, so the
// container module is the seam -- the same one `dashboard-scope.test.ts` uses
// for `DashboardService`.
const { containerGet } = vi.hoisted(() => ({ containerGet: vi.fn() }));
vi.mock("../di/container", () => ({ container: { get: containerGet } }));

// The entity-level read decision. Mocked so this handler test can put a caller
// on either side of it without standing up the RBAC stack.
const { canReadEntity } = vi.hoisted(() => ({ canReadEntity: vi.fn() }));
vi.mock("../auth/entity-read-access", () => ({ canReadEntity }));

import { requireAuthentication } from "../auth/middleware";
import { clearSources } from "../domains/widgets/sources";
import { NextlyError } from "../errors/nextly-error";
import { setNextlyLogger } from "../observability/logger";

import { postWidgetQuery } from "./widget-query";

const reqAuth = vi.mocked(requireAuthentication);

/** Captures what the boundary logs, so "it was logged" is observed, not assumed. */
const logged: object[] = [];
const testLogger = {
  error: (p: object) => void logged.push(p),
  warn: (p: object) => void logged.push(p),
  info: () => {},
  debug: () => {},
};

/** Reads the slots out of a batch response. */
async function slotsOf(
  res: Response
): Promise<Array<{ ok: boolean; error?: string }>> {
  const body = (await res.json()) as {
    results: Array<{ ok: boolean; error?: string }>;
  };
  return body.results;
}

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // `readCaller` is mocked below, so this auth context is never inspected
  // beyond `isErrorResponse`; shaped fully anyway so the mock stays typed.
  reqAuth.mockResolvedValue({
    userId: "user-1",
    permissions: [],
    roles: [],
    authMethod: "session",
  });
  readCaller.mockResolvedValue({ user: { id: "user-1", roles: ["editor"] } });
  executeWidgetQuery.mockResolvedValue({ op: "count", total: 3 });
  canReadEntity.mockResolvedValue(true);
  clearSources();
  logged.length = 0;
  setNextlyLogger(testLogger);
  containerGet.mockImplementation((name: string) => {
    if (name === "collectionRegistryService") {
      return { getAllCollections: async () => registeredCollections };
    }
    throw new Error(`unexpected container.get("${name}") in this test`);
  });
  // The endpoint derives its collection sources from the live collection
  // registry, so the fixture describes what that registry holds rather than
  // pre-registering a source the handler would replace anyway.
  registeredCollections = [
    {
      slug: "posts",
      fields: [{ name: "status", type: "text" }],
      timestamps: true,
    },
  ];
});

/** What the live collection registry answers with for the case under test. */
let registeredCollections: Array<{
  slug: string;
  fields: Array<{ name: string; type: string }>;
  timestamps: boolean;
}> = [];

afterEach(() => {
  setNextlyLogger(undefined);
});

describe("POST /api/dashboard/query", () => {
  it("returns one result per query, positionally", async () => {
    const res = await postWidgetQuery(
      makeReq({
        queries: [
          { source: "collection:posts", op: "count" },
          { source: "collection:posts", op: "count" },
        ],
      })
    );
    const body = (await res.json()) as { results: unknown[] };
    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(2);
  });

  it("passes the resolved caller to every execution, resolving it ONCE", async () => {
    await postWidgetQuery(
      makeReq({
        queries: [
          { source: "collection:posts", op: "count" },
          { source: "collection:posts", op: "count" },
        ],
      })
    );

    // Role-slug resolution is a database read; a 20-widget dashboard must not
    // pay for it 20 times.
    expect(readCaller).toHaveBeenCalledTimes(1);
    expect(executeWidgetQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        user: expect.objectContaining({ id: "user-1" }),
      })
    );
  });

  it("isolates one failing query instead of failing the batch", async () => {
    executeWidgetQuery
      .mockResolvedValueOnce({ op: "count", total: 1 })
      .mockRejectedValueOnce(new Error("boom"));

    const res = await postWidgetQuery(
      makeReq({
        queries: [
          { source: "collection:posts", op: "count" },
          { source: "collection:posts", op: "count" },
        ],
      })
    );
    const body = (await res.json()) as {
      results: Array<{ ok: boolean; error?: string }>;
    };
    expect(body.results[0].ok).toBe(true);
    expect(body.results[1].ok).toBe(false);
    // A widget's failure is its own card's problem, not the dashboard's.
    expect(res.status).toBe(200);
  });

  it("reports an invalid query as that query's failure, not a 400 for the batch", async () => {
    const res = await postWidgetQuery(
      makeReq({ queries: [{ source: "collection:nope", op: "count" }] })
    );
    const slots = await slotsOf(res);
    expect(res.status).toBe(200);
    expect(slots[0].ok).toBe(false);
    expect(slots[0].error).toBeTruthy();
  });

  it("refuses a batch larger than the cap", async () => {
    const queries = Array.from({ length: 40 }, () => ({
      source: "collection:posts",
      op: "count",
    }));
    const res = await postWidgetQuery(makeReq({ queries }));
    expect(res.status).toBe(400);
  });

  it("serves a collection that exists only in the Schema Builder", async () => {
    // A Builder-authored collection lives in `dynamic_collections` and is
    // ABSENT from `transformedConfig.collections`, so a source registry built
    // from the static config has no entry for it -- and the widget surface
    // silently refuses one of the framework's two schema modes while the
    // Direct API and the dashboard both read it fine. The registry is the
    // source of truth both of those already use.
    registeredCollections = [
      {
        slug: "reports",
        fields: [{ name: "title", type: "text" }],
        timestamps: true,
      },
    ];

    const res = await postWidgetQuery(
      makeReq({ queries: [{ source: "collection:reports", op: "count" }] })
    );

    const slots = await slotsOf(res);
    expect(slots[0].error).toBeUndefined();
    expect(slots[0].ok).toBe(true);
  });

  describe("a source the caller may not read is indistinguishable from one that does not exist", () => {
    // `validateWidgetQuery` used to run in full BEFORE anything authorized the
    // source, so the two answers diverged on the first field-level check: a
    // source that EXISTS returned `where references undeclared field "zzz" on
    // "collection:salaries"`, and one that does not returned the generic
    // unavailable-source refusal. Diffing the two walks an install's schema
    // one collection name at a time.
    const probe = (source: string) => ({
      queries: [{ source, op: "list", where: { zzz: { equals: 1 } } }],
    });

    beforeEach(() => {
      registeredCollections = [
        {
          slug: "salaries",
          fields: [{ name: "amount", type: "number" }],
          timestamps: true,
        },
      ];
      canReadEntity.mockResolvedValue(false);
    });

    it("answers the same for a forbidden source and an unknown one", async () => {
      const forbidden = await postWidgetQuery(
        makeReq(probe("collection:salaries"))
      );
      const unknown = await postWidgetQuery(makeReq(probe("collection:nope")));

      const a = (await slotsOf(forbidden))[0];
      const b = (await slotsOf(unknown))[0];

      expect(a.ok).toBe(false);
      expect(b.ok).toBe(false);
      expect(a.error).toBe(b.error);
      expect(a.error).not.toContain("salaries");
      expect(a.error).not.toContain("zzz");
    });

    it("answers the same for a forbidden source whose op IS supported", async () => {
      // `count` is supported by every collection source, so a query that is
      // otherwise well-formed reaches execution -- where a permission error
      // would name the refusal and confirm the collection is real.
      const forbidden = await postWidgetQuery(
        makeReq({ queries: [{ source: "collection:salaries", op: "count" }] })
      );
      const unknown = await postWidgetQuery(
        makeReq({ queries: [{ source: "collection:nope", op: "count" }] })
      );

      const a = (await slotsOf(forbidden))[0];
      const b = (await slotsOf(unknown))[0];
      expect(a.error).toBe(b.error);
      // Nothing ran: the refusal is taken before the query is compiled.
      expect(executeWidgetQuery).not.toHaveBeenCalled();
    });

    it("takes ONE read decision per entity for the whole batch", async () => {
      // The batch runs concurrently and a dashboard asks the same few
      // collections repeatedly, so a decision per SLOT fans out simultaneous
      // permission reads from a cold cache -- the pathology
      // `AUTHORIZATION_CONCURRENCY` exists to bound. Caching the promise, not
      // its result, is what makes concurrent slots share one decision.
      canReadEntity.mockResolvedValue(true);
      await postWidgetQuery(
        makeReq({
          queries: [
            { source: "collection:salaries", op: "count" },
            { source: "collection:salaries", op: "count" },
            { source: "collection:salaries", op: "count" },
          ],
        })
      );

      expect(canReadEntity).toHaveBeenCalledTimes(1);
      expect(canReadEntity).toHaveBeenCalledWith(
        "salaries",
        expect.objectContaining({ userId: "user-1" })
      );
    });

    it("keeps the reason in the log", async () => {
      await postWidgetQuery(makeReq(probe("collection:salaries")));
      expect(JSON.stringify(logged)).toContain("collection:salaries");
    });

    it("still gives a caller who MAY read the source the field-level detail", async () => {
      // The control. Flattening every pre-authorization answer is only correct
      // because the detail comes back once the caller has been authorized --
      // otherwise the fix is indistinguishable from deleting the messages, and
      // a widget author debugging a typo gets nothing to act on.
      canReadEntity.mockResolvedValue(true);

      const res = await postWidgetQuery(makeReq(probe("collection:salaries")));
      const slot = (await slotsOf(res))[0];

      expect(slot.ok).toBe(false);
      expect(slot.error).toContain("zzz");
    });
  });

  describe("a malformed body answers in the canonical error envelope", () => {
    // Both refusals used to hand-build `{ error: "some sentence" }` and return
    // it directly, bypassing `withErrorHandler`. A client parsing
    // `{ error: { code, message, requestId } }` -- which is what every other
    // endpoint in this package answers with, and what `parseApiError` reads --
    // sees `error` as a STRING here and cannot read a code off it.
    async function envelopeOf(body: unknown) {
      const res = await postWidgetQuery(makeReq(body));
      return {
        status: res.status,
        body: (await res.json()) as {
          error?: { code?: string; message?: string; requestId?: string };
        },
      };
    }

    it("answers a missing queries array with a coded error object", async () => {
      const { status, body } = await envelopeOf({});
      expect(status).toBe(400);
      expect(typeof body.error).toBe("object");
      expect(body.error?.code).toBe("VALIDATION_ERROR");
      expect(body.error?.requestId).toEqual(expect.any(String));
    });

    it("answers an oversized batch with a coded error object", async () => {
      const queries = Array.from({ length: 40 }, () => ({
        source: "collection:posts",
        op: "count",
      }));
      const { status, body } = await envelopeOf({ queries });
      expect(status).toBe(400);
      expect(typeof body.error).toBe("object");
      expect(body.error?.code).toBe("VALIDATION_ERROR");
      expect(body.error?.requestId).toEqual(expect.any(String));
    });
  });

  describe("a failed slot says nothing internal and is never swallowed", () => {
    it("does not put a non-NextlyError's own text on the wire", async () => {
      // The realistic shape: a driver or DbError message carrying SQL
      // fragments and column names, reaching any authenticated caller
      // verbatim under HTTP 200. Everywhere else the boundary maps a
      // non-NextlyError to `NextlyError.internal`, whose public message is
      // generic; this slot must answer the same way.
      const leak =
        'SQLITE_ERROR: no such column: posts.secret_salary in "SELECT ..."';
      executeWidgetQuery.mockRejectedValueOnce(new Error(leak));

      const res = await postWidgetQuery(
        makeReq({ queries: [{ source: "collection:posts", op: "count" }] })
      );

      const slots = await slotsOf(res);
      expect(slots[0].ok).toBe(false);
      expect(slots[0].error).not.toContain("SQLITE_ERROR");
      expect(slots[0].error).not.toContain("secret_salary");
      expect(slots[0].error).toBe("An unexpected error occurred.");
    });

    it("LOGS the original error the caller never sees", async () => {
      // The other half of the same catch: it swallowed the failure entirely,
      // so nothing in the observability stack ever learned a widget query
      // broke. Redacting the wire without logging would trade one defect for
      // a blinder one.
      const leak = "SQLITE_ERROR: no such column: posts.secret_salary";
      executeWidgetQuery.mockRejectedValueOnce(new Error(leak));

      await postWidgetQuery(
        makeReq({ queries: [{ source: "collection:posts", op: "count" }] })
      );

      expect(JSON.stringify(logged)).toContain("widget-query-failed");
      expect(JSON.stringify(logged)).toContain("secret_salary");
    });

    it("passes a NextlyError's public message through", async () => {
      // A named refusal is the whole value of the error to the caller -- a
      // widget filtering on a read-ruled field must be told which guard
      // refused it, not handed "an unexpected error occurred".
      executeWidgetQuery.mockRejectedValueOnce(NextlyError.forbidden());

      const res = await postWidgetQuery(
        makeReq({ queries: [{ source: "collection:posts", op: "count" }] })
      );

      const slots = await slotsOf(res);
      expect(slots[0].error).toBe(
        "You don't have permission to perform this action."
      );
    });

    it("answers the same for an unknown source and an unsupported op", async () => {
      // Distinguishable refusals make the endpoint a source-enumeration
      // oracle: "does not support op" confirms the source EXISTS, so a caller
      // can walk collection names and learn the schema of an install it was
      // never shown. The detail belongs in the log, not the reply.
      const unknownSource = await postWidgetQuery(
        makeReq({ queries: [{ source: "collection:salaries", op: "count" }] })
      );
      const unsupportedOp = await postWidgetQuery(
        makeReq({ queries: [{ source: "collection:posts", op: "groupBy" }] })
      );

      const a = (await slotsOf(unknownSource))[0];
      const b = (await slotsOf(unsupportedOp))[0];

      expect(a.ok).toBe(false);
      expect(b.ok).toBe(false);
      expect(a.error).toBe(b.error);
      expect(a.error).not.toContain("salaries");
      expect(b.error).not.toContain("groupBy");
    });

    it("keeps the source/op detail in the log", async () => {
      // The negative control for the test above: made indistinguishable to
      // the caller, NOT thrown away. An operator debugging a broken dashboard
      // still needs to know which source was named.
      await postWidgetQuery(
        makeReq({ queries: [{ source: "collection:salaries", op: "count" }] })
      );

      expect(JSON.stringify(logged)).toContain("collection:salaries");
    });
  });
});

describe("a body that is not JSON at all", () => {
  /** A request whose body the JSON parser cannot finish reading. */
  function makeRawReq(raw: string): Request {
    return new Request("http://localhost/api/dashboard/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
    });
  }

  it("answers 400 in the canonical validation envelope", async () => {
    // `req.json()` throws a raw `SyntaxError`, which `withErrorHandler`
    // classifies as internal -- so a truncated body answered 500 while the
    // body-SHAPE failures right below it answered with the canonical envelope.
    // Two refusals about the same request body, told two different ways.
    const res = await postWidgetQuery(makeRawReq('{"queries": ['));

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; data?: { errors: Array<{ code: string }> } };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.data?.errors[0].code).toBe("invalid_json");
  });

  it("answers the same way as a well-formed body of the wrong shape", async () => {
    // The property that was missing: both are refusals about the request body,
    // so a client has one envelope to parse and one code to branch on.
    const malformed = await postWidgetQuery(makeRawReq("not json"));
    const wrongShape = await postWidgetQuery(makeReq({ queries: "nope" }));

    expect(malformed.status).toBe(wrongShape.status);
    const a = (await malformed.json()) as { error: { code: string } };
    const b = (await wrongShape.json()) as { error: { code: string } };
    expect(a.error.code).toBe(b.error.code);
  });

  it("refuses the REQUEST rather than reporting a per-slot failure", async () => {
    // The batch shape isolates one query's failure into its own slot under a
    // 200, so "did not execute" alone does not separate the two outcomes -- a
    // 500 does not execute either. What separates them is that the body is a
    // canonical error envelope rather than a `results` array.
    const res = await postWidgetQuery(makeRawReq("{"));
    const body = (await res.json()) as { results?: unknown; error?: unknown };
    expect(body.results).toBeUndefined();
    expect(body.error).toBeDefined();
    expect(res.status).toBe(400);
    expect(executeWidgetQuery).not.toHaveBeenCalled();
  });
});
