/**
 * Which authority each release route demands.
 *
 * This is the security-bearing half of the HTTP surface. The route table names
 * dispatcher operations — list, single, create, update, delete — which cannot
 * express `publish`, so the mapping from method to release authority lives in
 * the handler. A mapping that quietly said `create` for scheduling would hand
 * everyone who can assemble a release the power to ship it, and every route
 * would still work, so nothing else would notice.
 *
 * Asserted on WHAT WAS ASKED of the permission gate rather than on the response,
 * because a refusal and a wrong-permission grant can produce the same status.
 *
 * @module api/__tests__/releases-route-authority.test
 */
import { NextlyError } from "../../errors";
import { RELEASE_STATES } from "../../schemas/releases/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAnyPermission, isErrorResponse, getCachedNextly, logger } =
  vi.hoisted(() => ({
    requireAnyPermission: vi.fn(),
    isErrorResponse: vi.fn(() => false),
    getCachedNextly: vi.fn(),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  }));

vi.mock("../../auth/middleware", () => ({
  requireAnyPermission,
  isErrorResponse,
}));
vi.mock("../../auth/middleware/to-nextly-error", () => ({
  toNextlyAuthError: (e: unknown) => e,
}));
vi.mock("../../init", () => ({ getCachedNextly }));
// The application logger the route reports to, observed rather than resolved
// from the container the case below stubs.
vi.mock("../../dispatcher/helpers/di", async importOriginal => ({
  ...(await importOriginal<typeof import("../../dispatcher/helpers/di")>()),
  getLoggerFromDI: () => logger,
}));
vi.mock("../../di", () => ({
  container: {
    has: () => true,
    // The registry answers what the SCHEMA declared. Default: the lifecycle is
    // on, because that is the ordinary collection a release targets.
    get: () => ({
      getCollectionBySlug: async () => lifecycleRecord,
      getSingleBySlug: async () => lifecycleRecord,
    }),
  },
}));

/** Swapped per case, so a target without a lifecycle can be expressed. */
let lifecycleRecord: { status?: boolean } | null = { status: true };

const { handleReleaseRequest } = await import("../releases");

/** The list meta of an empty first page, as the namespace answers it. */
interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}
const EMPTY_META: PageMeta = {
  total: 0,
  page: 1,
  limit: 50,
  totalPages: 0,
  hasNext: false,
  hasPrev: false,
};

/** Every namespace call the handler can make, all inert. */
function namespace() {
  return {
    // The member add resolves its target document before accepting it, so the
    // fake has to answer that read. Present rather than absent: a missing
    // reader would make the case fail for a reason unrelated to authority.
    findByID: vi.fn(
      async (): Promise<{ id: string; status?: string } | null> => ({
        id: "e1",
        status: "draft",
      })
    ),
    findSingle: vi.fn(
      async (): Promise<{ id: string; status?: string } | null> => ({
        id: "single-real-id",
        status: "draft",
      })
    ),
    releases: {
      // Takes its query, so a case can assert on what the route ASKED for. A
      // zero-argument stub records an empty call tuple, and a test reading
      // `calls[0][0]` from it does not compile — which is the compiler saying
      // the fake and the thing it stands in for have different shapes.
      find: vi.fn(
        async (
          _query: Record<string, unknown>
        ): Promise<{ items: { id: string }[]; meta: PageMeta }> => ({
          items: [],
          meta: EMPTY_META,
        })
      ),
      findByID: vi.fn(async () => ({ id: "r1" })),
      create: vi.fn(async () => ({ id: "r1" })),
      addMember: vi.fn(async () => ({ id: "m1" })),
      removeMember: vi.fn(async () => undefined),
      listMembers: vi.fn(async () => []),
      // The route decorates every release it returns with what this caller may
      // do to it. Answering with the rows' own ids rather than an empty map,
      // because an absent entry means "not permitted" — a fake that returned
      // nothing would make every response say no controls and hide the
      // difference between a refusal and a fake that did not answer.
      capabilities: vi.fn(
        async ({ releases }: { releases: readonly { id: string }[] }) =>
          new Map(
            releases.map(release => [
              release.id,
              {
                schedule: true,
                cancel: true,
                addMember: true,
                removeMember: true,
              },
            ])
          )
      ),
      // Answers a blocker, so a case can assert the detail read ASKED. A stub
      // returning nothing looks identical to a route that never asked, which is
      // the failure worth catching: the state says "blocked" and the screen
      // then has nothing to tell the operator to fix.
      blockingReasons: vi.fn(async () => [
        { memberId: "m1", reason: "AUTHOR_GONE" as const },
      ]),
      schedule: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      // Answers the release as it reads after the rename, so a case can say
      // the route returned it.
      update: vi.fn(async (_args: Record<string, unknown>) => ({
        id: "r1",
        title: "Renamed",
        state: "draft",
      })),
      // Answers the release as it was before the delete, as the service does.
      delete: vi.fn(async (_args: Record<string, unknown>) => ({
        id: "r1",
        title: "Old launch",
        state: "draft",
      })),
      // Answers the release as it stands after the run, so a case can say
      // which way it went.
      publishNow: vi.fn(
        async (): Promise<{
          id: string;
          state: string;
          scheduledAt?: Date | null;
        }> => ({
          id: "r1",
          state: "published",
        })
      ),
    },
  };
}

let api: ReturnType<typeof namespace>;

beforeEach(() => {
  lifecycleRecord = { status: true };
  api = namespace();
  getCachedNextly.mockResolvedValue(api);
  requireAnyPermission.mockResolvedValue({ userId: "u1" });
  isErrorResponse.mockReturnValue(false);
});

afterEach(() => {
  vi.clearAllMocks();
});

/** The single permission the handler demanded for this call. */
async function authorityFor(
  method: string,
  init?: { body?: unknown; params?: Record<string, string> }
): Promise<{ action: string; resource: string }> {
  const req = new Request("https://example.test/api/releases?limit=5", {
    method: init?.body === undefined ? "GET" : "POST",
    ...(init?.body === undefined
      ? {}
      : {
          body: JSON.stringify(init.body),
          headers: { "Content-Type": "application/json" },
        }),
  });
  await handleReleaseRequest(req, method, init?.params ?? { releaseId: "r1" });
  const asked = requireAnyPermission.mock.calls[0]?.[1] as {
    action: string;
    resource: string;
  }[];
  return asked[0];
}

describe("release route authority", () => {
  it("demands publish to schedule, not create", async () => {
    // THE case. Scheduling is the act that puts content live later; the seed
    // defines `publish-content-releases` as "schedule or cancel" precisely so it
    // can be withheld from someone allowed to assemble a release.
    expect(
      await authorityFor("scheduleRelease", {
        body: { at: "2026-09-01T09:00:00Z", timezone: "Europe/Berlin" },
      })
    ).toEqual({ action: "publish", resource: "content-releases" });
  });

  it("demands only READ to ask what is blocking a release", async () => {
    // A preflight is a question, not a change. Demanding `publish` to ask it
    // would mean the person assembling a release — who can add and remove the
    // documents that cause a blocker — could not find out which ones they are,
    // and would have to hand it to a publisher to be told.
    expect(await authorityFor("listReleaseBlockers")).toEqual({
      action: "read",
      resource: "content-releases",
    });
  });

  it("demands publish to publish now", async () => {
    // Running a release puts content live, the same power scheduling needs.
    // Anything less would let someone who may only assemble releases ship one.
    expect(await authorityFor("publishRelease")).toEqual({
      action: "publish",
      resource: "content-releases",
    });
  });

  it("demands publish to cancel", async () => {
    // Someone who could cancel but not schedule could still silently stop a
    // launch, so the two share one authority.
    expect(await authorityFor("cancelRelease", { body: {} })).toEqual({
      action: "publish",
      resource: "content-releases",
    });
  });

  it("demands create to assemble, never publish", async () => {
    for (const [method, body] of [
      ["createRelease", { title: "Launch" }],
      [
        "addReleaseMember",
        {
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId: "e1",
          action: "publish",
        },
      ],
    ] as const) {
      vi.clearAllMocks();
      requireAnyPermission.mockResolvedValue({ userId: "u1" });
      isErrorResponse.mockReturnValue(false);
      getCachedNextly.mockResolvedValue(api);
      expect(await authorityFor(method, { body })).toEqual({
        action: "create",
        resource: "content-releases",
      });
    }
  });

  it("demands only read to look", async () => {
    expect(await authorityFor("listReleases")).toEqual({
      action: "read",
      resource: "content-releases",
    });
  });

  it("turns the service's checks ON rather than trusting the route gate", async () => {
    // The route can only express the SYSTEM authority. Whether this caller may
    // publish the document they are adding is a question only the service can
    // ask, and it asks it only when `overrideAccess` is false.
    await authorityFor("addReleaseMember", {
      body: {
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: "e1",
        action: "publish",
      },
    });
    expect(api.releases.addMember).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", overrideAccess: false })
    );
  });

  it("refuses an unmapped method before authenticating", async () => {
    // A route added without an entry in the authority table would otherwise run
    // unauthorized. Refusing first makes the omission a 400, not a hole.
    const res = await handleReleaseRequest(
      new Request("https://example.test/api/releases"),
      "totallyNewRoute",
      {}
    );
    expect(res.status).toBe(400);
    expect(requireAnyPermission).not.toHaveBeenCalled();
  });
});

describe("release route input at the untyped boundary", () => {
  it("refuses an unrecognised state rather than widening the query", async () => {
    // A query string is whatever was sent. Dropping an unrecognised filter
    // WIDENS the request — the caller asked for one state and would receive
    // every release — and a client paging through what it believes is a
    // filtered list has no way to notice.
    const res = await handleReleaseRequest(
      new Request("https://example.test/api/releases?state=schedule"),
      "listReleases",
      {}
    );
    expect(res.status).toBe(400);
    expect(api.releases.find).not.toHaveBeenCalled();
  });

  it("passes a recognised state through", async () => {
    // The control: the guard must not refuse every state, which would make the
    // filter unusable and still pass the case above.
    await handleReleaseRequest(
      new Request("https://example.test/api/releases?state=scheduled"),
      "listReleases",
      {}
    );
    expect(api.releases.find).toHaveBeenCalledWith(
      expect.objectContaining({ state: "scheduled" })
    );
  });
});

describe("release route input validation", () => {
  async function post(
    method: string,
    body: unknown,
    params = { releaseId: "r1" }
  ) {
    return handleReleaseRequest(
      new Request("https://example.test/api/releases", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }),
      method,
      params
    );
  }

  it("refuses an instant that parses but is not ISO 8601", async () => {
    // `new Date("1")` is 2001-01-01 and `new Date("09/01/2026")` is
    // locale-dependent. Both are valid Dates at an instant the author never
    // chose — and a release publishes at it.
    for (const at of ["1", "09/01/2026", "next friday"]) {
      const res = await post("scheduleRelease", { at, timezone: "UTC" });
      expect(res.status, `accepted ${at}`).toBe(400);
    }
    expect(api.releases.schedule).not.toHaveBeenCalled();
  });

  it("refuses an instant with no zone, which the server would resolve in its own", async () => {
    // The case only the SHAPE check catches. "2026-09-01T09:00:00" parses, and
    // round-trips to the same calendar day, so every other guard admits it —
    // but it carries no zone, so the server resolves it locally and the same
    // request schedules different instants on two deployments.
    //
    // Added after a break-verify: disabling the shape check left the other
    // cases green, which meant the suite proved the round-trip guard and said
    // nothing about the shape one.
    const res = await post("scheduleRelease", {
      at: "2026-09-01T09:00:00",
      timezone: "UTC",
    });
    expect(res.status).toBe(400);
    expect(api.releases.schedule).not.toHaveBeenCalled();
  });

  it("refuses a date that does not exist", async () => {
    // 2026-02-30 is well-formed and normalises silently to March 2.
    const res = await post("scheduleRelease", {
      at: "2026-02-30T09:00:00Z",
      timezone: "UTC",
    });
    expect(res.status).toBe(400);
  });

  it("accepts a real ISO instant", async () => {
    // The control: the guard must not refuse every instant, which would make
    // scheduling impossible and still pass the cases above.
    const res = await post("scheduleRelease", {
      at: "2026-09-01T09:00:00Z",
      timezone: "Europe/Berlin",
    });
    expect(res.status).toBe(200);
    expect(api.releases.schedule).toHaveBeenCalled();
  });

  it("refuses a timezone the platform cannot format in", async () => {
    // A length check accepts `Europe/Berln`, which is stored, shown back to the
    // author as their intent, and throws whenever anything formats with it.
    const res = await post("scheduleRelease", {
      at: "2026-09-01T09:00:00Z",
      timezone: "Europe/Berln",
    });
    expect(res.status).toBe(400);
    expect(api.releases.schedule).not.toHaveBeenCalled();
  });

  it("refuses a non-string locale rather than widening the member", async () => {
    // Coercing a numeric locale id to `null` silently widens the member from
    // one language to the WHOLE document — the opposite of the request, and
    // indistinguishable downstream from a legitimate document-wide member.
    const res = await post("addReleaseMember", {
      scopeKind: "collection",
      scopeSlug: "posts",
      entryId: "e1",
      action: "publish",
      locale: 42,
    });
    expect(res.status).toBe(400);
    expect(api.releases.addMember).not.toHaveBeenCalled();
  });

  it("binds a member removal to the release in the path", async () => {
    await handleReleaseRequest(
      new Request("https://example.test/api/releases/r1/members/m1", {
        method: "DELETE",
      }),
      "removeReleaseMember",
      { releaseId: "r1", memberId: "m1" }
    );
    // Without the releaseId, `/releases/A/members/B` removes B even when it
    // belongs to release C, and the response says it worked.
    expect(api.releases.removeMember).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: "m1", releaseId: "r1" })
    );
  });

  it("forwards an API key's own grants rather than its owner's", async () => {
    requireAnyPermission.mockResolvedValueOnce({
      userId: "owner",
      authMethod: "api-key",
      permissions: ["read-content-releases"],
    });
    await handleReleaseRequest(
      new Request("https://example.test/api/releases"),
      "listReleases",
      {}
    );
    expect(api.releases.find).toHaveBeenCalledWith(
      expect.objectContaining({
        // See the note in `versions-access.test.ts`: the scope carries more
        // than these two fields, and this test is about which grant reaches
        // the call rather than about the scope's shape.
        authenticatedScope: expect.objectContaining({
          actorType: "apiKey",
          permissions: ["read-content-releases"],
        }),
      })
    );
  });

  it("carries no scope for a session, so ordinary RBAC applies", async () => {
    // The control: stamping a scope on a session request would make every
    // session resolve against an empty permission list and be refused.
    requireAnyPermission.mockResolvedValueOnce({
      userId: "u1",
      authMethod: "session",
      permissions: [],
    });
    await handleReleaseRequest(
      new Request("https://example.test/api/releases"),
      "listReleases",
      {}
    );
    expect(api.releases.find).toHaveBeenCalledWith(
      expect.objectContaining({ authenticatedScope: undefined })
    );
  });
});

describe("release member targets", () => {
  async function addMember(body: Record<string, unknown>) {
    return handleReleaseRequest(
      new Request("https://example.test/api/releases", {
        method: "POST",
        body: JSON.stringify({
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId: "e1",
          action: "publish",
          ...body,
        }),
        headers: { "Content-Type": "application/json" },
      }),
      "addReleaseMember",
      { releaseId: "r1" }
    );
  }

  it("leaves the target checks to the service, so every way in makes them", async () => {
    // The document's existence, its collection's lifecycle and a Single's own
    // id are decided by the releases service (`release-targets`), where the
    // Direct API reaches them too. The route passes the target through as sent
    // and reads no document itself.
    await addMember({
      scopeKind: "single",
      scopeSlug: "homepage",
      entryId: "as-sent",
    });
    expect(api.releases.addMember).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: "as-sent" })
    );
    expect(api.findSingle).not.toHaveBeenCalled();
    expect(api.findByID).not.toHaveBeenCalled();
  });
});

describe("release list windowing", () => {
  it("reports the whole list's total, not the rows on this page", async () => {
    // A page of two out of seven must say seven. A total taken from the page
    // tells a client the schedule is complete when five releases are missing.
    api.releases.find.mockResolvedValueOnce({
      items: [{ id: "a" }, { id: "b" }],
      meta: {
        total: 7,
        page: 1,
        limit: 2,
        totalPages: 4,
        hasNext: true,
        hasPrev: false,
      },
    });
    const res = await handleReleaseRequest(
      new Request("https://example.test/api/releases?limit=2"),
      "listReleases",
      {}
    );
    const body = (await res.json()) as {
      items: unknown[];
      meta: { total: number; totalPages: number; hasNext: boolean };
    };
    expect(body.items).toHaveLength(2);
    expect(body.meta).toMatchObject({ total: 7, totalPages: 4, hasNext: true });
    // Asked for exactly the page: the count comes from the service, so there
    // is no row fetched past the limit to infer "more" from.
    expect(api.releases.find).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2, page: 1 })
    );
  });

  it("refuses a window bound that is not a real ISO instant", async () => {
    // Held to the same contract as a scheduling instant. Two parsers for one
    // concept is how they drift: this one accepted `1` and normalised it into a
    // query bound nobody asked for.
    const res = await handleReleaseRequest(
      new Request("https://example.test/api/releases?scheduledAfter=1"),
      "listReleases",
      {}
    );
    expect(res.status).toBe(400);
  });

  it("accepts an instant at an offset that crosses midnight in UTC", async () => {
    // 2026-09-01T00:30:00+02:00 is August 31 in UTC and entirely valid.
    // Comparing the calendar day against the UTC rendering refused it — a real
    // instant rejected for every caller east of Greenwich.
    const res = await handleReleaseRequest(
      new Request(
        "https://example.test/api/releases?scheduledAfter=2026-09-01T00:30:00%2B02:00"
      ),
      "listReleases",
      {}
    );
    expect(res.status).toBe(200);
  });
});

describe("release route paging and body validation", () => {
  it("bounds an unlimited list rather than serialising the table", async () => {
    // `GET /api/releases` with no limit used to select every release. On an
    // installation with a real history that is an ordinary authenticated
    // request turned into an unbounded read.
    await handleReleaseRequest(
      new Request("https://example.test/api/releases"),
      "listReleases",
      {}
    );
    expect(api.releases.find).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 })
    );
  });

  it("refuses a page larger than the maximum", async () => {
    const res = await handleReleaseRequest(
      new Request("https://example.test/api/releases?limit=100000"),
      "listReleases",
      {}
    );
    expect(res.status).toBe(400);
    expect(api.releases.find).not.toHaveBeenCalled();
  });

  it("refuses a description that is present but not a string", async () => {
    // Coercing it to null turns a malformed request into silent data loss,
    // where every other bad field here answers 400.
    const res = await handleReleaseRequest(
      new Request("https://example.test/api/releases", {
        method: "POST",
        body: JSON.stringify({ title: "Launch", description: 42 }),
        headers: { "Content-Type": "application/json" },
      }),
      "createRelease",
      {}
    );
    expect(res.status).toBe(400);
    expect(api.releases.create).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown kind on the list", "listReleases", "?kind=singles", undefined],
    [
      "an unknown kind on a new release",
      "createRelease",
      "",
      { title: "Launch", kind: "singles" },
    ],
    [
      "an explicit null kind on a new release",
      "createRelease",
      "",
      { title: "Launch", kind: null },
    ],
  ])("refuses %s rather than ignoring it", async (_, op, query, body) => {
    // Ignored, `kind=singles` would list every release, and a new release
    // would be made ordinary when the caller asked for something else.
    const res = await handleReleaseRequest(
      new Request(`https://example.test/api/releases${query}`, {
        method: body === undefined ? "GET" : "POST",
        ...(body === undefined
          ? {}
          : {
              body: JSON.stringify(body),
              headers: { "Content-Type": "application/json" },
            }),
      }),
      op as "listReleases" | "createRelease",
      {}
    );
    expect(res.status).toBe(400);
    expect(api.releases.find).not.toHaveBeenCalled();
    expect(api.releases.create).not.toHaveBeenCalled();
  });

  it("passes a recognised kind through to the list and to a new release", async () => {
    // The control on the case above.
    await handleReleaseRequest(
      new Request("https://example.test/api/releases?kind=release"),
      "listReleases",
      {}
    );
    expect(api.releases.find).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "release" })
    );
    await handleReleaseRequest(
      new Request("https://example.test/api/releases", {
        method: "POST",
        body: JSON.stringify({ title: "Launch post", kind: "single" }),
        headers: { "Content-Type": "application/json" },
      }),
      "createRelease",
      {}
    );
    expect(api.releases.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Launch post", kind: "single" })
    );
  });

  it("forwards the authenticated roles, which code-defined rules evaluate", async () => {
    requireAnyPermission.mockResolvedValueOnce({
      userId: "u1",
      authMethod: "api-key",
      permissions: ["read-content-releases"],
      roles: ["editor"],
    });
    await handleReleaseRequest(
      new Request("https://example.test/api/releases"),
      "listReleases",
      {}
    );
    // With `roles: []` a role-positive rule rejects a valid key, and an
    // absence-based rule admits one it should refuse.
    expect(api.releases.find).toHaveBeenCalledWith(
      expect.objectContaining({ userRoles: ["editor"] })
    );
  });
});

describe("the list's tab, search, page and order", () => {
  async function list(search: string) {
    return handleReleaseRequest(
      new Request(`https://example.test/api/releases${search}`),
      "listReleases",
      {}
    );
  }

  it("passes a tab, a search, a page and an order through", async () => {
    const res = await list("?tab=upcoming&search=spring&page=3&order=latest");
    expect(res.status).toBe(200);
    expect(api.releases.find).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: "upcoming",
        search: "spring",
        page: 3,
        order: "latest",
      })
    );
    const attention = await list("?tab=attention&reason=overdue");
    expect(attention.status).toBe(200);
    expect(api.releases.find).toHaveBeenLastCalledWith(
      expect.objectContaining({ tab: "attention", reason: "overdue" })
    );
  });

  it.each([
    ["an unknown tab", "?tab=soon"],
    ["page 0", "?page=0"],
    ["a page that is not a whole number", "?page=2a"],
    ["a page past the safe integers", "?page=1e308"],
    ["an unknown order", "?order=soonestt"],
    ["an unknown reason", "?tab=attention&reason=late"],
  ])("refuses %s rather than answering with every release", async (_, q) => {
    // Each would otherwise be dropped or defaulted, and a client paging
    // through what it believes is a narrowed list could not tell.
    const res = await list(q);
    expect(res.status).toBe(400);
    expect(api.releases.find).not.toHaveBeenCalled();
  });

  it.each(["tab=upcoming", "search=spring", "order=latest", "reason=overdue"])(
    "refuses %s alongside a document filter",
    async extra => {
      // One document's releases are not a tab, are not searched, and come in
      // the order they apply to it; accepting the parameter and dropping it
      // would answer a different question.
      const res = await list(
        `?containingScopeKind=collection&containingScopeSlug=posts&containingEntryId=e1&${extra}`
      );
      expect(res.status).toBe(400);
      expect(api.releases.find).not.toHaveBeenCalled();
    }
  );
});

describe("filtering the list to the releases holding ONE document", () => {
  /** What the namespace's `find` received for this query string. */
  async function queryFor(search: string) {
    const api = namespace();
    getCachedNextly.mockResolvedValue(api);
    const res = await handleReleaseRequest(
      new Request(`https://example.test/api/releases${search}`),
      "listReleases",
      {}
    );
    return { res, query: api.releases.find.mock.calls[0]?.[0] };
  }

  it("passes a COMPLETE reference through as a whole-document ref", async () => {
    const { query } = await queryFor(
      "?containingScopeKind=collection&containingScopeSlug=posts&containingEntryId=e1"
    );
    // Asserted on what the service RECEIVED rather than on the status, because
    // a filter that is parsed and then dropped answers 200 with every release
    // — which is the failure worth catching and which no status code reveals.
    expect(query).toMatchObject({
      containing: {
        scopeKind: "collection",
        scopeSlug: "posts",
        entryId: "e1",
        // A member is whole-document: the service refuses a locale-scoped one,
        // so this surface must not invent a narrowing the engine lacks.
        locale: null,
      },
    });
  });

  it("passes NO filter when none was asked for", async () => {
    // The control. Without it, a parser that always produced a `containing`
    // key would satisfy the case above just as well.
    const { query } = await queryFor("?limit=5");
    expect(query).not.toHaveProperty("containing");
  });

  it.each([
    ["?containingScopeKind=collection"],
    ["?containingScopeSlug=posts"],
    ["?containingEntryId=e1"],
    ["?containingScopeKind=collection&containingScopeSlug=posts"],
    ["?containingScopeSlug=posts&containingEntryId=e1"],
    [
      "?containingScopeKind=widget&containingScopeSlug=posts&containingEntryId=e1",
    ],
  ])("refuses the PARTIAL or unmodelled reference %s", async search => {
    // Refused rather than ignored. Dropping an incomplete reference answers
    // with every release instead of the ones holding the document, and a
    // document banner rendering that tells an author their post is in eleven
    // launches.
    const { res, query } = await queryFor(search);
    expect(res.status).toBe(400);
    expect(query).toBeUndefined();
  });
});

describe("the detail read explains a BLOCKED release", () => {
  async function detail(state: string) {
    const api = namespace();
    api.releases.findByID = vi.fn(async () => ({ id: "r1", state }));
    getCachedNextly.mockResolvedValue(api);
    const res = await handleReleaseRequest(
      new Request("https://example.test/api/releases/r1"),
      "getRelease",
      { releaseId: "r1" }
    );
    // `respondDoc` sends the document ITSELF — there is no `item` wrapper, and
    // reading one would make both cases below pass by finding undefined.
    return { api, body: (await res.json()) as { blockedBy?: unknown } };
  }

  it("asks WHY, and sends it, when the release is blocked", async () => {
    // Without this the state is a dead end: it says the launch will not happen
    // and nothing says which member to fix.
    const { api, body } = await detail("blocked");
    expect(api.releases.blockingReasons).toHaveBeenCalled();
    expect(body.blockedBy).toEqual([{ memberId: "m1", reason: "AUTHOR_GONE" }]);
  });

  it("does not ask for a release that is fine", async () => {
    // The control, and a real cost: the question runs an identity lookup over
    // every member, and asking it on every detail read would pay that to be
    // told nothing is wrong — which the state already said.
    const { api, body } = await detail("scheduled");
    expect(api.releases.blockingReasons).not.toHaveBeenCalled();
    expect(body.blockedBy).toBeUndefined();
  });
});

describe("publish now over REST", () => {
  async function publish() {
    const res = await handleReleaseRequest(
      new Request("https://example.test/api/releases/r1/publish", {
        method: "POST",
      }),
      "publishRelease",
      { releaseId: "r1" }
    );
    return {
      res,
      body: (await res.json()) as {
        message: string;
        item: { id: string; state: string; can?: unknown };
      },
    };
  }

  it("runs the release it names and answers it as it now stands", async () => {
    const { res, body } = await publish();
    expect(res.status).toBe(200);
    expect(api.releases.publishNow).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1" })
    );
    expect(body.message).toBe("Release published.");
    expect(body.item).toMatchObject({ id: "r1", state: "published" });
    // With what the caller may do next, as every other release answer carries.
    expect(body.item.can).toBeDefined();
  });

  it("does not call a release published while some of it is still going out", async () => {
    // A large release can outlast the request, and another run of the drain
    // may already hold it; either way the runner finishes it. Saying
    // "published" then would tell the person it is done when it is not.
    api.releases.publishNow.mockResolvedValueOnce({
      id: "r1",
      state: "scheduled",
    });
    const { body } = await publish();
    expect(body.message).not.toBe("Release published.");
    expect(body.message).toMatch(/going out/);
  });

  it("names the new instant of a release rescheduled for later while it was being sent", async () => {
    // Moved to the future by another request after Publish now judged it due:
    // the drain leaves it until then, so "shortly" would be untrue.
    const later = new Date(Date.now() + 60 * 60 * 1000);
    api.releases.publishNow.mockResolvedValueOnce({
      id: "r1",
      state: "scheduled",
      scheduledAt: later,
    });
    const { body } = await publish();
    expect(body.message).toContain(later.toISOString());
    expect(body.message).not.toMatch(/going out;|shortly/);
  });

  it("still says a due release is going out", async () => {
    api.releases.publishNow.mockResolvedValueOnce({
      id: "r1",
      state: "scheduled",
      scheduledAt: new Date(Date.now() - 1000),
    });
    const { body } = await publish();
    expect(body.message).toMatch(/going out/);
  });

  it("says a release cancelled after the move was cancelled, not that it is going out", async () => {
    // Called off between the move and the answer: nothing more of it goes
    // out, and a message promising the rest would be untrue.
    api.releases.publishNow.mockResolvedValueOnce({
      id: "r1",
      state: "cancelled",
    });
    const { body } = await publish();
    expect(body.message).toMatch(/cancelled/);
    expect(body.message).not.toMatch(/going out|published/);
  });

  it.each(
    RELEASE_STATES.filter(state => state !== "scheduled").map(state => [state])
  )(
    "says only a scheduled release is going out, never a %s one",
    async state => {
      // Every state the answer can carry has its own sentence, so no state
      // falls into the one that promises the rest is on its way.
      api.releases.publishNow.mockResolvedValueOnce({ id: "r1", state });
      const { body } = await publish();
      expect(body.message).not.toMatch(/going out/);
    }
  );

  it("says a release that stopped part-way stopped, not that it is going out", async () => {
    api.releases.publishNow.mockResolvedValueOnce({
      id: "r1",
      state: "blocked",
    });
    const { body } = await publish();
    expect(body.message).toMatch(/stopped/);
    expect(body.message).not.toMatch(/going out/);
  });

  it("answers a publish that happened even when reading its capabilities fails, and logs why", async () => {
    // The capabilities are decoration on a write that has already committed.
    // Any failure to read them, not only a refusal, must not turn a release
    // that went out into a failed request the person then retries.
    api.releases.capabilities.mockRejectedValueOnce(
      new Error("capabilities read failed")
    );
    const { res, body } = await publish();
    expect(res.status).toBe(200);
    expect(body.item).toMatchObject({ id: "r1", state: "published" });
    expect(body.item.can).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        releaseId: "r1",
        error: "capabilities read failed",
      })
    );
  });

  it("answers a publish that happened even when the caller may not read capabilities", async () => {
    // A key scoped to publish releases has no read grant. The run has already
    // written; refusing now would report it as not having happened.
    api.releases.capabilities.mockRejectedValueOnce(
      NextlyError.forbidden({ logContext: { reason: "no-read" } })
    );
    const { res, body } = await publish();
    expect(res.status).toBe(200);
    expect(body.item).toMatchObject({ id: "r1", state: "published" });
    expect(body.item.can).toBeUndefined();
  });
});

describe("renaming and deleting a release", () => {
  /** A request to one release, with a JSON body when one is given. */
  async function send(method: string, verb: string, body?: unknown) {
    return handleReleaseRequest(
      new Request("https://example.test/api/releases/r1", {
        method: verb,
        ...(body === undefined
          ? {}
          : {
              body: JSON.stringify(body),
              headers: { "Content-Type": "application/json" },
            }),
      }),
      method,
      { releaseId: "r1" }
    );
  }

  it("demands update to rename, not create", async () => {
    // Renaming went with assembling before it had a permission of its own.
    // Asking `create` here would let every assembler rename on a route that
    // says it needs `update`.
    expect(
      await authorityFor("updateRelease", { body: { title: "Renamed" } })
    ).toEqual({ action: "update", resource: "content-releases" });
  });

  it("demands delete to delete, not publish", async () => {
    expect(await authorityFor("deleteRelease")).toEqual({
      action: "delete",
      resource: "content-releases",
    });
  });

  it("hands the service the rename with its checks turned on", async () => {
    const res = await send("updateRelease", "PATCH", {
      title: "Renamed",
      description: null,
    });
    expect(res.status).toBe(200);
    expect(api.releases.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "r1",
        title: "Renamed",
        description: null,
        userId: "u1",
        overrideAccess: false,
      })
    );
    // The mutation envelope, with the release as it now reads.
    const body = (await res.json()) as {
      message: string;
      item: { title: string };
    };
    expect(body.item.title).toBe("Renamed");
  });

  it.each([
    ["no field", {}],
    ["an empty title", { title: "" }],
    ["a title longer than every dialect stores", { title: "x".repeat(256) }],
    ["a title that is not text", { title: 7 }],
    ["a description that is not text", { description: 7 }],
    // Accepted and ignored, this would answer 200 for a move that never
    // happened; a state is changed by its own route.
    ["a field the route does not change", { title: "Renamed", state: "draft" }],
  ])("refuses %s, and renames nothing", async (_name, body) => {
    const res = await send("updateRelease", "PATCH", body);
    expect(res.status).toBe(400);
    expect(api.releases.update).not.toHaveBeenCalled();
  });

  it("deletes the release in the path, with its checks turned on, and answers the mutation envelope", async () => {
    const res = await send("deleteRelease", "DELETE");
    expect(res.status).toBe(200);
    // `{ message, item }`, as every other delete in this API answers, with the
    // release as it was.
    expect(await res.json()).toEqual({
      message: "Release deleted.",
      item: { id: "r1", title: "Old launch", state: "draft" },
    });
    expect(api.releases.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "r1",
        userId: "u1",
        overrideAccess: false,
      })
    );
  });
});
