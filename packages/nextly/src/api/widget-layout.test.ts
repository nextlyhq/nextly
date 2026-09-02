/**
 * The layout endpoint's two jobs: never disclose a card this reader may not
 * know about, and never lose one because it was not disclosed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { readCaller } = vi.hoisted(() => ({ readCaller: vi.fn() }));
vi.mock("./authenticated-read", async importOriginal => {
  const actual = await importOriginal<typeof import("./authenticated-read")>();
  return { ...actual, readCaller };
});

const { containerGet } = vi.hoisted(() => ({ containerGet: vi.fn() }));
vi.mock("../di", () => ({ container: { get: containerGet } }));

// `callerHoldsPermission` is the seam a caller is put on either side of.
// `authorizationGroups` stays REAL: it is a pure function of a slug list and
// the concurrency bound, so a stand-in would make the batching assert against
// the test's own arithmetic rather than the bound the product enforces.
const { callerHoldsPermission } = vi.hoisted(() => ({
  callerHoldsPermission: vi.fn(),
}));
vi.mock("../auth/entity-read-access", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../auth/entity-read-access")>();
  return { ...actual, callerHoldsPermission };
});

import { requireAuthentication } from "../auth/middleware";
import type { WidgetDefinition } from "../domains/widgets/definition";
import {
  serializeLayout,
  visibilityToken,
  type WidgetPlacement,
} from "../domains/widgets/layout";
import { SKIP_DATE_FORMATTING_HEADER } from "./response-shapes";
import {
  clearWidgets,
  listWidgets,
  registerWidget,
} from "../domains/widgets/registry";

import { getWidgetLayout, putWidgetLayout } from "./widget-layout";

const reqAuth = vi.mocked(requireAuthentication);

/** A stand-in for the row, so a test can state what is stored and read it back. */
let stored: { layout: string; version: number } | undefined;
let saved: { placements: WidgetPlacement[]; expected: number } | undefined;
let saveThrows: Error | undefined;
const logged: object[] = [];

const fakeService = {
  getLayout: async () => {
    if (!stored) return { layout: undefined, version: 0, unreadable: false };
    // The real service decodes here and reports an unreadable row rather than
    // throwing onward; reproduced so this test sees the same three outcomes.
    const { readStoredLayout } = await import("../domains/widgets/layout");
    try {
      return {
        layout: readStoredLayout(stored.layout),
        version: stored.version,
        unreadable: false,
      };
    } catch {
      logged.push({ unreadable: true });
      return { layout: undefined, version: stored.version, unreadable: true };
    }
  },
  saveLayout: async (
    _kind: string,
    _scope: string,
    placements: WidgetPlacement[],
    expected: number
  ) => {
    if (saveThrows) throw saveThrows;
    saved = { placements, expected };
    return expected + 1;
  },
};

function widget(patch: Partial<WidgetDefinition>): WidgetDefinition {
  return {
    id: "core/one",
    title: "One",
    archetype: "custom",
    defaultSize: "full",
    component: "core#One",
    ...patch,
  } as WidgetDefinition;
}

function getReq(): Request {
  return new Request("http://localhost/api/dashboard/layout");
}

/**
 * The token the endpoint will compute for a given visible set.
 *
 * Derived from the registry the test just populated rather than hard-coded, so
 * a test that changes its fixtures cannot leave a stale literal behind that
 * happens to still pass.
 */
function scopeFor(visibleIds?: string[]): string {
  return visibilityToken(visibleIds ?? listWidgets().map(w => w.id));
}

function putReq(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface LayoutPayload {
  placements?: WidgetPlacement[];
  version?: number;
  source?: string;
  scope?: string;
}

/** A GET answers with the object itself. */
async function bodyOf(res: Response): Promise<LayoutPayload> {
  return (await res.json()) as LayoutPayload;
}

/**
 * A PUT answers with the canonical mutation envelope, so the payload is under
 * `item`. Read through its own helper rather than by reaching into `bodyOf`'s
 * result, so a test asserting on the payload cannot silently pass against a
 * body that never had one.
 */
async function itemOf(res: Response): Promise<LayoutPayload> {
  const body = (await res.json()) as {
    message?: string;
    item?: LayoutPayload;
  };
  expect(body.message).toEqual(expect.any(String));
  expect(body.item).toBeDefined();
  return body.item as LayoutPayload;
}

beforeEach(() => {
  vi.clearAllMocks();
  stored = undefined;
  saved = undefined;
  saveThrows = undefined;
  logged.length = 0;
  clearWidgets();
  reqAuth.mockResolvedValue({
    userId: "user-1",
    permissions: [],
    roles: [],
    authMethod: "session",
  });
  readCaller.mockResolvedValue({ user: { id: "user-1", roles: ["editor"] } });
  callerHoldsPermission.mockResolvedValue(true);
  containerGet.mockImplementation((name: string) => {
    if (name === "widgetLayoutService") return fakeService;
    throw new Error(`unexpected container.get("${name}") in this test`);
  });
});

describe("GET /api/dashboard/layout", () => {
  it("answers from the registry when nothing is stored", async () => {
    registerWidget(widget({ id: "core/b", defaultOrder: 10 }));
    registerWidget(widget({ id: "core/a", defaultOrder: 0 }));

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.source).toBe("default");
    expect(body.version).toBe(0);
    expect(body.placements?.map(p => p.widgetId)).toEqual(["core/a", "core/b"]);
  });

  it("omits a widget whose permission this caller lacks", async () => {
    registerWidget(widget({ id: "core/open" }));
    registerWidget(
      widget({ id: "core/gated", requiredPermission: "read-secrets" })
    );
    callerHoldsPermission.mockResolvedValue(false);

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements?.map(p => p.widgetId)).toEqual(["core/open"]);
    // Asked about the gated widget's slug, and NOT about the ungated one --
    // omitting `requiredPermission` means "any authenticated reader", so a
    // check there would be a decision nobody declared.
    expect(callerHoldsPermission).toHaveBeenCalledTimes(1);
    expect(callerHoldsPermission).toHaveBeenCalledWith(
      "read-secrets",
      expect.anything()
    );
  });

  it("denies when the permission decision itself rejects", async () => {
    registerWidget(
      widget({ id: "core/gated", requiredPermission: "read-secrets" })
    );
    callerHoldsPermission.mockRejectedValue(new Error("rbac down"));

    const body = await bodyOf(await getWidgetLayout(getReq()));

    // Fail closed: a check that threw has told us nothing, and "nothing" must
    // not read as "allowed".
    expect(body.placements).toEqual([]);
  });

  it("returns a stored arrangement in its own order", async () => {
    registerWidget(widget({ id: "core/a" }));
    registerWidget(widget({ id: "core/b" }));
    stored = {
      version: 4,
      layout: serializeLayout([
        { id: "p2", widgetId: "core/b", order: 0, hidden: false },
        { id: "p1", widgetId: "core/a", order: 10, hidden: true },
      ]),
    };

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.source).toBe("own");
    expect(body.version).toBe(4);
    // Sorted by the reader's own order, not the registry's -- and the hidden
    // one still comes back, or nothing could ever put it back.
    expect(body.placements?.map(p => p.id)).toEqual(["p2", "p1"]);
  });

  it("drops a stored placement whose widget is gone, without saying so", async () => {
    registerWidget(widget({ id: "core/a" }));
    stored = {
      version: 1,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/a", order: 0, hidden: false },
        { id: "p2", widgetId: "plugin/uninstalled", order: 10, hidden: false },
      ]),
    };

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements?.map(p => p.id)).toEqual(["p1"]);
    expect(JSON.stringify(body)).not.toContain("uninstalled");
  });

  it("falls back to the registry on an unreadable row, keeping its version", async () => {
    registerWidget(widget({ id: "core/a" }));
    stored = { version: 7, layout: "{not json" };

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.source).toBe("default");
    expect(body.placements?.map(p => p.widgetId)).toEqual(["core/a"]);
    // The TRUE version, not 0. Reporting 0 would tell the client there is no
    // row, sending its next PUT down the insert path to collide with the row
    // that is still there -- turning a recoverable bad row into a dashboard
    // that can never be saved.
    expect(body.version).toBe(7);
  });
});

describe("opaque config survives the response pipeline", () => {
  it.each([
    ["GET", async () => getWidgetLayout(getReq())],
    [
      "PUT",
      async () =>
        putWidgetLayout(
          putReq({
            placements: [
              { id: "p1", widgetId: "core/a", order: 0, hidden: false },
            ],
            version: 0,
            scope: visibilityToken(["core/a"]),
          })
        ),
    ],
  ])("%s opts out of date formatting", async (_verb, call) => {
    // The route handler rewrites date-looking strings in every JSON payload by
    // VALUE, not merely by key name -- so a plugin's opaque
    // `config: { cutoff: "2026-09-02T04:00:00.000Z" }` comes back timezone
    // shifted, the client submits the shifted value in its next whole-snapshot
    // PUT, and it is persisted. The configuration this endpoint calls opaque
    // then drifts one offset further on every save.
    registerWidget(widget({ id: "core/a" }));

    const res = await call();

    expect(res.headers.get(SKIP_DATE_FORMATTING_HEADER)).toBe("1");
  });
});

describe("PUT /api/dashboard/layout", () => {
  const onePlacement: WidgetPlacement[] = [
    { id: "p1", widgetId: "core/a", order: 0, hidden: false },
  ];

  it("stores what the caller submitted", async () => {
    registerWidget(widget({ id: "core/a" }));

    const res = await putWidgetLayout(
      putReq({ placements: onePlacement, version: 0, scope: scopeFor() })
    );

    expect(res.status).toBe(200);
    expect(saved?.expected).toBe(0);
    expect(saved?.placements.map(p => p.id)).toEqual(["p1"]);
  });

  it("carries through a placement the caller was never shown", async () => {
    // 🔴 THE rule. The client is handed a FILTERED list and sends the whole
    // thing back. Writing it verbatim would delete every placement the filter
    // hid, so a reader who opened the dashboard once while a permission of
    // theirs was narrowed would lose those cards permanently.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(
      widget({ id: "core/gated", requiredPermission: "read-secrets" })
    );
    callerHoldsPermission.mockResolvedValue(false);
    stored = {
      version: 2,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/a", order: 0, hidden: false },
        { id: "p9", widgetId: "core/gated", order: 10, hidden: false },
      ]),
    };

    await putWidgetLayout(
      putReq({
        placements: onePlacement,
        version: 2,
        scope: scopeFor(["core/a"]),
      })
    );

    expect(saved?.placements.map(p => p.widgetId)).toEqual([
      "core/a",
      "core/gated",
    ]);
  });

  it("does not echo the carried placement back to the caller", async () => {
    registerWidget(widget({ id: "core/a" }));
    registerWidget(
      widget({ id: "core/gated", requiredPermission: "read-secrets" })
    );
    callerHoldsPermission.mockResolvedValue(false);
    stored = {
      version: 2,
      layout: serializeLayout([
        { id: "p9", widgetId: "core/gated", order: 10, hidden: false },
      ]),
    };

    const res = await putWidgetLayout(
      putReq({
        placements: onePlacement,
        version: 2,
        scope: scopeFor(["core/a"]),
      })
    );
    const raw = res.clone();
    const item = await itemOf(res);

    // Preserving it must not become a way to learn it is there -- asserted over
    // the WHOLE response body, not just the payload, so a leak in the envelope
    // or a warning line would fail too.
    expect(await raw.text()).not.toContain("gated");
    expect(item.placements?.map(p => p.id)).toEqual(["p1"]);
  });

  it("refuses a placement naming a widget the caller cannot see", async () => {
    registerWidget(
      widget({ id: "core/gated", requiredPermission: "read-secrets" })
    );
    callerHoldsPermission.mockResolvedValue(false);

    const res = await putWidgetLayout(
      putReq({
        placements: [
          { id: "p1", widgetId: "core/gated", order: 0, hidden: false },
        ],
        version: 0,
        // The visible set is EMPTY here, and that is the scope the client
        // would have been handed -- so this reaches the foreign-widget rule
        // rather than being turned away by the scope guard first.
        scope: scopeFor([]),
      })
    );

    expect(res.status).toBe(400);
    expect(saved).toBeUndefined();
  });

  it("refuses two placements sharing an id", async () => {
    registerWidget(widget({ id: "core/a" }));

    const res = await putWidgetLayout(
      putReq({
        placements: [
          { id: "dup", widgetId: "core/a", order: 0, hidden: false },
          { id: "dup", widgetId: "core/a", order: 1, hidden: false },
        ],
        version: 0,
        scope: scopeFor(),
      })
    );

    expect(res.status).toBe(400);
    expect(saved).toBeUndefined();
  });

  it.each([
    ["a missing version", { placements: [], scope: "x" }],
    ["a string version", { placements: [], version: "3", scope: "x" }],
    ["a fractional version", { placements: [], version: 1.5, scope: "x" }],
    ["a negative version", { placements: [], version: -1, scope: "x" }],
  ])("refuses %s rather than coercing it", async (_label, body) => {
    // `Number("")` is 0, which is the "there is no row yet" version -- so a
    // coerced empty field would assert the row does not exist and overwrite a
    // real arrangement through the insert path.
    const res = await putWidgetLayout(putReq(body));
    expect(res.status).toBe(400);
    expect(saved).toBeUndefined();
  });

  it("refuses a body that is not an object", async () => {
    const res = await putWidgetLayout(putReq([]));
    expect(res.status).toBe(400);
    expect(saved).toBeUndefined();
  });

  it("refuses a write whose visible set moved since the read", async () => {
    // 🔴 The regression this token exists for, in the exact shape that lost
    // data. The client read while `core/gated` was invisible, so its snapshot
    // holds only `core/a`. A grant lands. Without the guard, `core/gated` is
    // visible at write time -- so it is in neither the submission nor the
    // carried-through set, and the write DELETES it, with `version` matching
    // because a permission grant does not touch the row.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(
      widget({ id: "core/gated", requiredPermission: "read-secrets" })
    );
    stored = {
      version: 2,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/a", order: 0, hidden: false },
        { id: "p9", widgetId: "core/gated", order: 10, hidden: false },
      ]),
    };
    // The grant has landed by the time the PUT arrives.
    callerHoldsPermission.mockResolvedValue(true);

    const res = await putWidgetLayout(
      putReq({
        placements: onePlacement,
        version: 2,
        // The token the client was handed while the widget was still hidden.
        scope: scopeFor(["core/a"]),
      })
    );

    expect(res.status).toBe(409);
    // Nothing was written, so the placement is still there to be re-read.
    expect(saved).toBeUndefined();
  });

  it("refuses a write whose visible set SHRANK since the read", async () => {
    // The mirror case, and it must be a CONFLICT rather than a validation
    // error: the client is holding a stale view, not a malformed body.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(
      widget({ id: "core/gated", requiredPermission: "read-secrets" })
    );
    callerHoldsPermission.mockResolvedValue(false);

    const res = await putWidgetLayout(
      putReq({
        placements: [
          { id: "p1", widgetId: "core/gated", order: 0, hidden: false },
        ],
        version: 0,
        scope: scopeFor(["core/a", "core/gated"]),
      })
    );

    expect(res.status).toBe(409);
    expect(saved).toBeUndefined();
  });

  it("requires the scope token rather than treating it as optional", async () => {
    // Optional would mean absent for every client that has not been updated --
    // which is every client that still has the bug.
    registerWidget(widget({ id: "core/a" }));

    const res = await putWidgetLayout(
      putReq({ placements: onePlacement, version: 0 })
    );

    expect(res.status).toBe(400);
    expect(saved).toBeUndefined();
  });

  it("refuses an API key, which has no dashboard to arrange", async () => {
    registerWidget(widget({ id: "core/a" }));
    reqAuth.mockResolvedValue({
      userId: "user-1",
      permissions: ["read-posts"],
      roles: [],
      authMethod: "api-key",
    });

    const res = await putWidgetLayout(
      putReq({ placements: onePlacement, version: 0, scope: scopeFor() })
    );

    expect(res.status).toBe(403);
    expect(saved).toBeUndefined();
  });

  it("refuses a payload larger than the narrowest dialect's column", async () => {
    // MySQL's TEXT is 65535 BYTES and the other two are effectively unbounded,
    // so without a cap the same PUT stores on two dialects and truncates on the
    // third -- leaving JSON the next read cannot parse, which loses the whole
    // saved dashboard on one deployment only.
    registerWidget(widget({ id: "core/a" }));

    const res = await putWidgetLayout(
      putReq({
        placements: [
          {
            id: "p1",
            widgetId: "core/a",
            order: 0,
            hidden: false,
            config: { blob: "x".repeat(40_000) },
          },
        ],
        version: 0,
        scope: scopeFor(),
      })
    );

    expect(res.status).toBe(400);
    expect(saved).toBeUndefined();
  });

  it("refuses an API key BEFORE it reads the body", async () => {
    // The refusal is a precondition, so it must not depend on the body being
    // well formed. With the check placed after the parse, this unparseable body
    // came back as a validation error -- telling a caller which field it got
    // wrong on a request it was never allowed to make, and paying for the parse
    // in order to say so.
    registerWidget(widget({ id: "core/a" }));
    reqAuth.mockResolvedValue({
      userId: "user-1",
      permissions: [],
      roles: [],
      authMethod: "api-key",
    });

    const res = await putWidgetLayout(
      new Request("http://localhost/api/dashboard/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{ this is not json",
      })
    );

    expect(res.status).toBe(403);
  });

  it("carries invisible defaults into the FIRST save", async () => {
    // With no stored row the caller was still shown a FILTERED default set, so
    // writing back only what they saw freezes a snapshot that never contained
    // the gated defaults -- and `defaultPlacements` runs only while the row is
    // absent, so a permission granted afterwards could never reveal them. The
    // visibility token catches a grant between the read and the write; nothing
    // catches one that lands after a successful save except this.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(
      widget({ id: "core/gated", requiredPermission: "read-secrets" })
    );
    callerHoldsPermission.mockResolvedValue(false);

    await putWidgetLayout(
      putReq({
        placements: onePlacement,
        version: 0,
        scope: scopeFor(["core/a"]),
      })
    );

    expect(saved?.placements.map(p => p.widgetId)).toEqual([
      "core/a",
      "core/gated",
    ]);
  });

  /*
   * There is deliberately no test here for a widget whose `requiredPermission`
   * is a truthy non-string.
   *
   * Two locks stand between that value and this endpoint, and BOTH are outside
   * it: `widgetValueProblem` refuses the declaration (covered in
   * `domains/widgets/__tests__/definition.test.ts`), and `registerWidget`
   * stores a FROZEN snapshot, so the entry cannot be mutated into that state
   * afterwards either -- measured, not assumed: assigning to what `listWidgets`
   * returns throws `object is not extensible`.
   *
   * So `isVisibleTo`'s non-string branch is unreachable from any caller outside
   * the widgets domain, and a test claiming to exercise it would be producing
   * the state by some route the product does not have. The branch stays,
   * because unreachability is a property of the current call graph rather than
   * of the code, and a `typeof` on a value already in hand costs nothing when
   * its rejection never runs.
   */

  it("accepts the same submission whether or not hidden data is carried", async () => {
    // 🔴 The oracle is the pass/fail EDGE, not the number in the message.
    // Omitting the byte count from a merged-size refusal leaves acceptance
    // itself varying with data the caller cannot see, so a caller could
    // binary-search a visible placement's size against it and read the boundary
    // as the size of configuration they are not allowed to see. There is no
    // merged check at all now: the stored column cannot be reached, so the
    // answer to an identical submission is identical either way.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(
      widget({ id: "core/gated", requiredPermission: "read-secrets" })
    );
    callerHoldsPermission.mockResolvedValue(false);

    const submission = {
      placements: onePlacement,
      version: 1,
      scope: scopeFor(["core/a"]),
    };

    // With a large hidden placement carried.
    stored = {
      version: 1,
      layout: serializeLayout([
        {
          id: "p9",
          widgetId: "core/gated",
          order: 0,
          hidden: false,
          config: { blob: "y".repeat(60_000) },
        },
      ]),
    };
    const withHidden = await putWidgetLayout(putReq(submission));

    // And with none.
    saved = undefined;
    stored = {
      version: 1,
      layout: serializeLayout([
        { id: "p9", widgetId: "core/gated", order: 0, hidden: false },
      ]),
    };
    const withoutHidden = await putWidgetLayout(putReq(submission));

    expect(withHidden.status).toBe(withoutHidden.status);
    expect(withHidden.status).toBe(200);
  });

  it("keeps a carried default in its DECLARED position", async () => {
    // 🔴 Positions come from a placement's index in the sorted set, so
    // materializing over the FILTERED set and materializing over the full
    // registry produce colliding numbers: visible A and B surrounding a gated G
    // give A=0, B=10 from the filtered view and G=10 from the full one. The
    // stored row then holds two placements at 10, and the moment the permission
    // is granted the tie sorts A, B, G instead of the declared A, G, B — the
    // reader's arrangement reordering itself because they gained access.
    registerWidget(widget({ id: "core/a", defaultOrder: 0 }));
    registerWidget(
      widget({
        id: "core/gated",
        defaultOrder: 10,
        requiredPermission: "read-secrets",
      })
    );
    registerWidget(widget({ id: "core/b", defaultOrder: 20 }));
    callerHoldsPermission.mockResolvedValue(false);

    const shown = await bodyOf(await getWidgetLayout(getReq()));
    expect(shown.placements?.map(p => p.widgetId)).toEqual([
      "core/a",
      "core/b",
    ]);

    await putWidgetLayout(
      putReq({
        placements: shown.placements,
        version: 0,
        scope: scopeFor(["core/a", "core/b"]),
      })
    );

    // Sorted the way a later read will sort it, with the gate lifted.
    const order = [...(saved?.placements ?? [])]
      .sort((x, y) => x.order - y.order)
      .map(p => p.widgetId);
    expect(order).toEqual(["core/a", "core/gated", "core/b"]);
  });

  it("refuses an oversized body without buffering it", async () => {
    // `req.json()` reads the whole body before anything can look at it, so a
    // quota checked on the parsed result has already paid for the memory and
    // the parse it exists to prevent.
    registerWidget(widget({ id: "core/a" }));
    const huge = JSON.stringify({
      placements: [
        {
          id: "p1",
          widgetId: "core/a",
          order: 0,
          hidden: false,
          config: { blob: "z".repeat(200_000) },
        },
      ],
      version: 0,
      scope: "x",
    });

    const res = await putWidgetLayout(
      new Request("http://localhost/api/dashboard/layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: huge,
      })
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("too_large");
    // Refused before any of the work it protects.
    expect(saved).toBeUndefined();
    expect(callerHoldsPermission).not.toHaveBeenCalled();
  });

  it("checks the caller's quota before resolving anything", async () => {
    // The quota is a precondition and it is cheap, so nothing it protects
    // should be paid for first. Under the body cap, over the placement count.
    registerWidget(widget({ id: "core/a" }));
    const many = Array.from({ length: 400 }, (_, i) => ({
      id: `p${i}`,
      widgetId: "core/a",
      order: i,
      hidden: false,
    }));

    const res = await putWidgetLayout(
      putReq({ placements: many, version: 0, scope: "x" })
    );

    expect(res.status).toBe(400);
    expect(callerHoldsPermission).not.toHaveBeenCalled();
    expect(saved).toBeUndefined();
  });

  it("reports a version conflict as a conflict", async () => {
    registerWidget(widget({ id: "core/a" }));
    const { NextlyError } = await import("../errors/nextly-error");
    saveThrows = NextlyError.conflict({ reason: "version" });

    const res = await putWidgetLayout(
      putReq({ placements: onePlacement, version: 1, scope: scopeFor() })
    );

    expect(res.status).toBe(409);
  });
});
