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
  DEFAULT_COLUMN_COUNT,
  MAX_PLACEMENTS,
  layoutSizeProblem,
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
import { setContributedWidgets } from "../domains/widgets/canonical";

import {
  deleteWidgetLayout,
  getWidgetLayout,
  putWidgetLayout,
} from "./widget-layout";

const reqAuth = vi.mocked(requireAuthentication);

/** A stand-in for the row, so a test can state what is stored and read it back. */
let stored: { layout: string; version: number } | undefined;
let saved:
  | { placements: WidgetPlacement[]; expected: number; columnCount?: number }
  | undefined;
let saveThrows: Error | undefined;
let deleted: { kind: string; scope: string } | undefined;
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
  deleteLayout: async (kind: string, scope: string) => {
    deleted = { kind, scope };
    stored = undefined;
  },
  saveLayout: async (
    _kind: string,
    _scope: string,
    placements: WidgetPlacement[],
    expected: number,
    columnCount?: number
  ) => {
    if (saveThrows) throw saveThrows;
    // The count is recorded because the response ECHOES one: a writer that
    // answered with the right number while storing another would satisfy every
    // assertion made on the body alone.
    saved = { placements, expected, columnCount };
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
  available?: string[];
  version?: number;
  source?: string;
  scope?: string;
  columnCount?: number;
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
  deleted = undefined;
  logged.length = 0;
  clearWidgets();
  setContributedWidgets([]);
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
        { id: "p2", widgetId: "core/b", column: 0, order: 0, hidden: false },
        { id: "p1", widgetId: "core/a", column: 0, order: 10, hidden: true },
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
        { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: false },
        {
          id: "p2",
          widgetId: "plugin/uninstalled",
          column: 0,
          order: 10,
          hidden: false,
        },
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

describe("a widget that only CONTRIBUTED", () => {
  it("appears in the default arrangement", async () => {
    // 🔴 The defect. Layout resolution read the imperative registry alone, so a
    // plugin using the documented `contributes.admin.widgets` surface rendered
    // a card on the grid that was absent from every arrangement.
    registerWidget(widget({ id: "core/a" }));
    setContributedWidgets([{ id: "forms/latest", defaultOrder: 5 }]);

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements?.map(p => p.widgetId)).toEqual([
      "forms/latest",
      "core/a",
    ]);
  });

  it("can be saved into an arrangement", async () => {
    // Every PUT naming a contributed widget was refused as unavailable, so the
    // card could not be arranged, hidden or added even by a client that knew
    // about it.
    setContributedWidgets([{ id: "forms/latest" }]);

    const res = await putWidgetLayout(
      putReq({
        placements: [
          {
            id: "p1",
            widgetId: "forms/latest",
            column: 0,
            order: 0,
            hidden: false,
          },
        ],
        version: 0,
        scope: scopeFor(["forms/latest"]),
      })
    );

    expect(res.status).toBe(200);
    expect(saved?.placements.map(p => p.widgetId)).toEqual(["forms/latest"]);
  });

  it("is offered in `available` when it is not placed", async () => {
    registerWidget(widget({ id: "core/a" }));
    setContributedWidgets([{ id: "forms/latest" }]);
    stored = {
      version: 2,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: false },
      ]),
    };

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.available).toEqual(["forms/latest"]);
  });

  it("is gated by its declared permission like any other", async () => {
    setContributedWidgets([
      { id: "forms/latest", requiredPermission: "read-forms" },
    ]);
    callerHoldsPermission.mockResolvedValue(false);

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements).toEqual([]);
    expect(callerHoldsPermission).toHaveBeenCalledWith(
      "read-forms",
      expect.anything()
    );
  });

  it("takes the geometry it declared, unknown values included", async () => {
    // A contribution may come from a plugin built against a newer core, so an
    // unrecognised size must reach the placement rather than being refused.
    setContributedWidgets([{ id: "forms/latest", defaultSize: "xxl" }]);

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements?.[0]).toMatchObject({ size: "xxl" });
  });
});

describe("a widget registered after the reader last saved", () => {
  it("is not inserted into their arrangement", async () => {
    // The product decision: a newly installed plugin's card is never pushed
    // into somebody's saved layout behind their back.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(widget({ id: "core/new" }));
    stored = {
      version: 3,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: false },
      ]),
    };

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements?.map(p => p.widgetId)).toEqual(["core/a"]);
  });

  it("is still named, so it can be added", async () => {
    // 🔴 "Not auto-added" only works if it is ADDABLE. Without this the widget
    // was discoverable from nothing: absent from every read, absent from the
    // snapshot the next write persisted, and the reader with no way to learn it
    // existed at all.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(widget({ id: "core/new" }));
    stored = {
      version: 3,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: false },
      ]),
    };

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.available).toEqual(["core/new"]);
  });

  it("names nothing this caller may not see", async () => {
    // The unplaced set is drawn from the widgets already filtered by
    // permission, so it cannot become the disclosure the placements avoid.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(
      widget({ id: "core/gated", requiredPermission: "read-secrets" })
    );
    callerHoldsPermission.mockResolvedValue(false);
    stored = {
      version: 1,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: false },
      ]),
    };

    const res = await getWidgetLayout(getReq());
    const raw = await res.clone().text();
    const body = await bodyOf(res);

    expect(body.available).toEqual([]);
    expect(raw).not.toContain("gated");
  });

  it("names nothing when the reader has no stored row", async () => {
    // Every visible widget is placed by the default arrangement, so there is
    // nothing left to offer.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(widget({ id: "core/b" }));

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.available).toEqual([]);
    expect(body.placements).toHaveLength(2);
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
              {
                id: "p1",
                widgetId: "core/a",
                column: 0,
                order: 0,
                hidden: false,
              },
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
    { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: false },
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
        { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: false },
        {
          id: "p9",
          widgetId: "core/gated",
          column: 0,
          order: 10,
          hidden: false,
        },
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
        {
          id: "p9",
          widgetId: "core/gated",
          column: 0,
          order: 10,
          hidden: false,
        },
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
          {
            id: "p1",
            widgetId: "core/gated",
            column: 0,
            order: 0,
            hidden: false,
          },
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
          { id: "dup", widgetId: "core/a", column: 0, order: 0, hidden: false },
          { id: "dup", widgetId: "core/a", column: 0, order: 1, hidden: false },
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
        { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: false },
        {
          id: "p9",
          widgetId: "core/gated",
          column: 0,
          order: 10,
          hidden: false,
        },
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
          {
            id: "p1",
            widgetId: "core/gated",
            column: 0,
            order: 0,
            hidden: false,
          },
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
            column: 0,
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
          column: 0,
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
        {
          id: "p9",
          widgetId: "core/gated",
          column: 0,
          order: 0,
          hidden: false,
        },
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
          column: 0,
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
      column: 0,
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

describe("DELETE /api/dashboard/layout", () => {
  it("removes the row and reports the reset", async () => {
    registerWidget(widget({ id: "core/a" }));
    stored = {
      version: 4,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: true },
      ]),
    };

    const res = await deleteWidgetLayout(
      new Request("http://localhost/api/dashboard/layout", { method: "DELETE" })
    );

    expect(res.status).toBe(200);
    expect(deleted).toEqual({ kind: "user", scope: "user-1" });
  });

  it("leaves the reader tracking the live registry, not a frozen copy", async () => {
    // 🔴 The reason this is a DELETE and not a PUT of the current defaults.
    // Writing a snapshot would freeze today's defaults into the row, so a
    // widget registered later — or a `defaultOrder` a plugin changes later —
    // would never reach this reader again. They would be "reset" onto a layout
    // that no longer tracks the thing they reset to.
    registerWidget(widget({ id: "core/a" }));
    stored = {
      version: 4,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: true },
      ]),
    };

    await deleteWidgetLayout(
      new Request("http://localhost/api/dashboard/layout", { method: "DELETE" })
    );

    // A widget that did not exist when the row was written.
    registerWidget(widget({ id: "core/added-later" }));
    const after = await bodyOf(await getWidgetLayout(getReq()));

    expect(after.source).toBe("default");
    expect(after.version).toBe(0);
    expect(after.placements?.map(p => p.widgetId)).toEqual([
      "core/a",
      "core/added-later",
    ]);
  });

  it("refuses an API key", async () => {
    reqAuth.mockResolvedValue({
      userId: "user-1",
      permissions: [],
      roles: [],
      authMethod: "api-key",
    });

    const res = await deleteWidgetLayout(
      new Request("http://localhost/api/dashboard/layout", { method: "DELETE" })
    );

    expect(res.status).toBe(403);
    expect(deleted).toBeUndefined();
  });
});

describe("the submission cap, when an install declares more than one write may carry", () => {
  /** `MAX_PLACEMENTS` denied widgets in declared order, then one ungated. */
  function overCapacity(): void {
    for (let i = 0; i < MAX_PLACEMENTS; i++) {
      registerWidget(
        widget({
          id: `core/denied-${i}`,
          defaultOrder: i,
          requiredPermission: "read-secrets",
        })
      );
    }
    registerWidget(widget({ id: "core/open", defaultOrder: MAX_PLACEMENTS }));
    callerHoldsPermission.mockResolvedValue(false);
  }

  it("does not let widgets this caller cannot see consume it", async () => {
    // 🔴 The cap used to be applied to the whole-registry materialization,
    // before the visible half was partitioned out. Widgets the caller may not
    // know exist therefore spent the allowance: two hundred denied ones ahead
    // of an ungated widget left that reader with an EMPTY dashboard and the one
    // card they were entitled to relegated to `available`.
    overCapacity();

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements?.map(p => p.widgetId)).toEqual(["core/open"]);
    expect(body.available ?? []).not.toContain("core/open");
  });

  it("still bounds what the caller is asked to submit", async () => {
    // The other direction, and the reason the cap exists at all: a default the
    // write contract would refuse is not a default. With every widget visible,
    // the placements stay inside the limit and the surplus is offered instead.
    for (let i = 0; i < MAX_PLACEMENTS + 5; i++) {
      registerWidget(widget({ id: `core/w${i}`, defaultOrder: i }));
    }
    callerHoldsPermission.mockResolvedValue(true);

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements).toHaveLength(MAX_PLACEMENTS);
    expect(layoutSizeProblem(body.placements ?? [])).toBeUndefined();
    // The surplus is reachable rather than lost.
    expect(body.available).toContain(`core/w${MAX_PLACEMENTS}`);
  });
});

describe("the column count travels with the arrangement", () => {
  it("ANSWERS a column count on a dashboard nobody has arranged", async () => {
    // 🔴 The count decides which column a placement's coordinate names, so a
    // client left to assume it draws a DIFFERENT arrangement from the stored
    // one — and then saves that back. Sending it is what stops a dashboard
    // being silently re-columned by whatever the client guessed.
    registerWidget(widget({ id: "core/a", defaultOrder: 0 }));
    const body = await bodyOf(await getWidgetLayout(getReq()));
    expect(typeof body.columnCount).toBe("number");
    // The control: not merely present, but a count this core would honour on
    // the way back in. A response carrying a value the reader refuses is worse
    // than one carrying none.
    expect([2, 3, 4]).toContain(body.columnCount);
  });
});

describe("a stored row describes itself", () => {
  it("BOUNDS a submitted column against the count that was accepted", async () => {
    // 🔴 The two tolerances disagreed. An unsupported `columnCount` is coerced
    // to the default, while a placement's `column` was only bounded downward —
    // so `{ columnCount: 5, column: 4 }` persisted as a 3-column row holding a
    // card in column 4. Nothing rejects that row; every reader silently
    // reinterprets it, and the arrangement a reader gets back is not the one
    // they sent.
    registerWidget(widget({ id: "core/a", defaultOrder: 0 }));
    const res = await putWidgetLayout(
      putReq({
        placements: [
          {
            id: "p1",
            widgetId: "core/a",
            column: 4,
            order: 0,
            hidden: false,
          },
        ],
        version: 0,
        scope: scopeFor(["core/a"]),
        columnCount: 5,
      })
    );
    expect(res.status).toBe(200);
    const saved = await itemOf(res);
    // Coerced ONCE, at the boundary, so the row is self-describing rather than
    // reinterpreted differently by whoever reads it next.
    expect(saved.columnCount).toBeLessThanOrEqual(4);
    for (const placement of saved.placements ?? []) {
      expect(placement.column).toBeLessThan(saved.columnCount ?? 3);
    }
  });

  it("KEEPS the stored count when a PUT omits one", async () => {
    // 🔴 Every client written before columns sends no `columnCount`, and this
    // endpoint accepts the omission. Defaulting on their behalf rewrote a
    // four-column row as a three-column one, after which the bounding step
    // folds every card in the fourth column into the third — permanently, and
    // during an edit that touched neither the count nor that card.
    registerWidget(widget({ id: "core/a", defaultOrder: 0 }));
    stored = {
      version: 2,
      layout: serializeLayout(
        [{ id: "p1", widgetId: "core/a", column: 3, order: 0, hidden: false }],
        4
      ),
    };

    const res = await putWidgetLayout(
      putReq({
        placements: [
          { id: "p1", widgetId: "core/a", column: 3, order: 0, hidden: false },
        ],
        version: 2,
        scope: scopeFor(["core/a"]),
      })
    );

    expect(res.status).toBe(200);
    const item = await itemOf(res);
    expect(item.columnCount).toBe(4);
    // The consequence, not only the number: the card in the fourth column is
    // still in the fourth column. A row that kept the count while the bounding
    // step had already moved the card would satisfy the assertion above.
    expect(item.placements?.[0]?.column).toBe(3);
    expect(saved?.columnCount).toBe(4);
    expect(saved?.placements[0]?.column).toBe(3);
  });

  it("still takes a count the client actually SENT", async () => {
    // The control. Inheriting whenever the stored row has a count would
    // satisfy the case above while making the picker unable to narrow a
    // dashboard at all — the same defect pointing the other way.
    registerWidget(widget({ id: "core/a", defaultOrder: 0 }));
    stored = {
      version: 2,
      layout: serializeLayout(
        [{ id: "p1", widgetId: "core/a", column: 3, order: 0, hidden: false }],
        4
      ),
    };

    const res = await putWidgetLayout(
      putReq({
        placements: [
          { id: "p1", widgetId: "core/a", column: 3, order: 0, hidden: false },
        ],
        version: 2,
        scope: scopeFor(["core/a"]),
        columnCount: 2,
      })
    );

    expect(res.status).toBe(200);
    const item = await itemOf(res);
    expect(item.columnCount).toBe(2);
    // Narrowing folds the card into the last column that now exists, which is
    // the documented behaviour for a column that went away.
    expect(item.placements?.[0]?.column).toBe(1);
  });

  it("KEEPS each card's column when the placements state none", async () => {
    // 🔴 Preserving the count alone was half an answer. A client written before
    // columns omits the coordinate on every placement as well, and the reader
    // has to turn an omission into a number — so the row kept its four columns
    // while every card in it had been moved into the first. The arrangement was
    // destroyed by an edit that named neither the count nor any column.
    registerWidget(widget({ id: "core/a", defaultOrder: 0 }));
    registerWidget(widget({ id: "core/b", defaultOrder: 1 }));
    stored = {
      version: 2,
      layout: serializeLayout(
        [
          { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: false },
          { id: "p2", widgetId: "core/b", column: 3, order: 10, hidden: false },
        ],
        4
      ),
    };

    const res = await putWidgetLayout(
      putReq({
        // Exactly what a pre-column client sends: no `columnCount`, and no
        // `column` on any placement.
        placements: [
          { id: "p1", widgetId: "core/a", order: 0, hidden: false },
          { id: "p2", widgetId: "core/b", order: 10, hidden: false },
        ],
        version: 2,
        scope: scopeFor(["core/a", "core/b"]),
      })
    );

    expect(res.status).toBe(200);
    const byId = new Map(
      (await itemOf(res)).placements?.map(p => [p.id, p.column]) ?? []
    );
    expect(byId.get("p2")).toBe(3);
    // The control: `p1` was already in column 0, so it alone cannot tell
    // "kept its column" from "collapsed everything into the first".
    expect(byId.get("p1")).toBe(0);
    expect(saved?.placements.find(p => p.id === "p2")?.column).toBe(3);
  });

  it("inherits from the DEFAULT arrangement when there is no stored row", async () => {
    // 🔴 A caller who has never saved was still handed an arrangement — the
    // server's round-robin default, which spreads the first widgets across the
    // columns. A pre-column client round-trips that set without the field it
    // does not know about, and inheritance that reads only the stored row finds
    // nothing to inherit, so the very first save flattens the default into one
    // column. The baseline has to be what the caller was SHOWN, and with no row
    // that is the defaults.
    registerWidget(widget({ id: "core/a", defaultOrder: 0 }));
    registerWidget(widget({ id: "core/b", defaultOrder: 1 }));
    registerWidget(widget({ id: "core/c", defaultOrder: 2 }));

    // Exactly what a GET hands out, so the fixture is the arrangement the
    // client is round-tripping rather than one invented here.
    const offered = (await bodyOf(await getWidgetLayout(getReq()))).placements;
    expect(offered?.map(p => p.column)).toEqual([0, 1, 2]);

    const res = await putWidgetLayout(
      putReq({
        // The same placements with `column` dropped, which is all a pre-column
        // client can send.
        placements: offered?.map(({ id, widgetId, order, hidden }) => ({
          id,
          widgetId,
          order,
          hidden,
        })),
        version: 0,
        scope: scopeFor(["core/a", "core/b", "core/c"]),
      })
    );

    expect(res.status).toBe(200);
    const saved2 = (await itemOf(res)).placements;
    expect(saved2?.map(p => p.column)).toEqual([0, 1, 2]);
  });

  it("never inherits from a placement this caller cannot SEE", async () => {
    // 🔴 An existence oracle. Default placement ids ARE widget ids, so a caller
    // can submit a placement whose id names a widget they may not know about
    // and whose `widgetId` is one they may. Inheriting across the whole stored
    // row echoed the hidden placement's column straight back, and a nonzero one
    // distinguishes a hit — which is the disclosure `mergePreservingHidden`
    // re-keys collisions to prevent. The baseline is the caller's own visible
    // half, so there is nothing of the hidden row in it to leak.
    registerWidget(widget({ id: "core/a", defaultOrder: 0 }));
    registerWidget(
      widget({ id: "core/gated", requiredPermission: "read-secrets" })
    );
    callerHoldsPermission.mockResolvedValue(false);
    stored = {
      version: 2,
      layout: serializeLayout(
        [
          { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: false },
          {
            id: "probe",
            widgetId: "core/gated",
            column: 3,
            order: 10,
            hidden: false,
          },
        ],
        4
      ),
    };

    const res = await putWidgetLayout(
      putReq({
        placements: [
          // The probe: an id that collides with the hidden placement, carrying
          // a widget this caller legitimately holds, and stating no column.
          { id: "probe", widgetId: "core/a", order: 0, hidden: false },
        ],
        version: 2,
        scope: scopeFor(["core/a"]),
      })
    );

    expect(res.status).toBe(200);
    const echoed = (await itemOf(res)).placements ?? [];
    expect(echoed).toHaveLength(1);
    // Column 0 is the reader's own fallback, which says nothing. Column 3 would
    // be the hidden placement's, and is the whole finding.
    expect(echoed[0]?.column).toBe(0);
    // The control: the hidden placement is still CARRIED into the row, so this
    // is inheritance being scoped rather than the placement having vanished —
    // which would satisfy the assertion above for the wrong reason.
    expect(
      saved?.placements.find(p => p.widgetId === "core/gated")?.column
    ).toBe(3);
  });

  it("still MOVES a card whose placement states a column", async () => {
    // The control. Inheriting whenever a stored placement exists would satisfy
    // the case above while making every sideways move unsaveable — the same
    // defect pointing the other way, and the one a reader would notice first.
    registerWidget(widget({ id: "core/a", defaultOrder: 0 }));
    stored = {
      version: 2,
      layout: serializeLayout(
        [{ id: "p1", widgetId: "core/a", column: 3, order: 0, hidden: false }],
        4
      ),
    };

    const res = await putWidgetLayout(
      putReq({
        placements: [
          { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: false },
        ],
        version: 2,
        scope: scopeFor(["core/a"]),
        columnCount: 4,
      })
    );

    expect(res.status).toBe(200);
    expect((await itemOf(res)).placements?.[0]?.column).toBe(0);
  });

  it("DEFAULTS the count when there is no stored row to inherit from", async () => {
    // The other control. Inheriting is only right where something exists to
    // inherit; a first save has to land on a count this core supports rather
    // than on whatever an absent row reads as.
    registerWidget(widget({ id: "core/a", defaultOrder: 0 }));

    const res = await putWidgetLayout(
      putReq({
        placements: [
          { id: "p1", widgetId: "core/a", column: 0, order: 0, hidden: false },
        ],
        version: 0,
        scope: scopeFor(["core/a"]),
      })
    );

    expect(res.status).toBe(200);
    expect((await itemOf(res)).columnCount).toBe(DEFAULT_COLUMN_COUNT);
  });
});
