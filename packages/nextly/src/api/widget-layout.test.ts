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

// Which of the default's cards their declared widgets' own rules would not
// show the reader: the case states it, since that judgement has its own tests.
const { defaultCardsNotShown } = vi.hoisted(() => ({
  defaultCardsNotShown: vi.fn(),
}));
vi.mock("./default-cards-shown", () => ({ defaultCardsNotShown }));
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

// The Get started steps, as the case states them; the rest of that module
// (skips) stays real, since the endpoint applies them.
const { getStartedSteps } = vi.hoisted(() => ({ getStartedSteps: vi.fn() }));
vi.mock("../domains/widgets/get-started", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../domains/widgets/get-started")>();
  return {
    ...actual,
    getStartedSteps,
    // The probe reads the steps through their detail: the same answer, with
    // nothing fallen back, so a case states the answer once.
    getStartedDetail: async (...args: unknown[]) => ({
      answer: (await getStartedSteps(...args)) as unknown,
      fellBack: new Set(),
      unlisted: false,
    }),
  };
});

import { requireAuthentication } from "../auth/middleware";
import type { WidgetDefinition } from "../domains/widgets/definition";
import {
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
import { CORE_DEFAULT_LAYOUT } from "../domains/widgets/core-widgets/ids";
import {
  setDefaultLayoutPlan,
  type DefaultLayoutPlan,
} from "../domains/widgets/default-layout";
import { collectionSettingsToken } from "../domains/widgets/collection-cards";
import type { PluginDefinition } from "../plugins/plugin-context";
import { contributedWidgetSummaries } from "../plugins/validate-admin-widgets";

import {
  deleteWidgetLayout,
  getWidgetLayout,
  putWidgetLayout,
} from "./widget-layout";

const reqAuth = vi.mocked(requireAuthentication);

/** A stand-in for the row, so a test can state what is stored and read it back. */
let stored: { layout: string; version: number } | undefined;
let saved:
  | {
      placements: WidgetPlacement[];
      expected: number;
      arranged?: boolean;
    }
  | undefined;
let saveThrows: Error | undefined;
let deleted: { kind: string; scope: string; expected: number } | undefined;
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
  deleteLayout: async (kind: string, scope: string, expected: number) => {
    deleted = { kind, scope, expected };
    stored = undefined;
  },
  saveLayout: async (
    _kind: string,
    _scope: string,
    placements: WidgetPlacement[],
    expected: number,
    arranged?: boolean
  ) => {
    if (saveThrows) throw saveThrows;
    // Whether the write ARRANGES is recorded because nothing in the response
    // says it, so the only place a wrong answer is visible is what reaches the
    // service.
    saved = { placements, expected, arranged };
    return expected + 1;
  },
};

function widget(patch: Partial<WidgetDefinition>): WidgetDefinition {
  const definition = {
    id: "core/one",
    title: "One",
    archetype: "custom",
    size: { default: { w: 12, h: 3 } },
    component: "core#One",
    ...patch,
  };
  // A key set to `undefined` is one JSON drops, and a registration carrying
  // one is not one the admin may receive -- so a patch that unsets the base
  // fixture's `component` removes the key rather than voiding it.
  return withoutUndefined(definition) as WidgetDefinition;
}

/** `value` less every key set to `undefined`. */
function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;
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
function scopeFor(
  visibleIds?: string[],
  heldActionGates: string[] = []
): string {
  return visibilityToken(
    visibleIds ?? listWidgets().map(w => w.id),
    heldActionGates
  );
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
  defaultPlacements?: WidgetPlacement[];
  widgets?: Record<
    string,
    {
      allowsSeveral: boolean;
      group?: string;
      subgroup?: string;
      description?: string;
      category?: string;
      sketch?: string;
      rank?: number;
    }
  >;
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
  setDefaultLayoutPlan({
    cards: CORE_DEFAULT_LAYOUT,
    suggestions: true,
    suggested: [],
  });
  defaultCardsNotShown.mockResolvedValue(new Set());
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
        { id: "p2", widgetId: "core/b", w: 12, h: 3, removed: false },
        { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: true },
      ]),
    };

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.source).toBe("own");
    expect(body.version).toBe(4);
    // Sorted by the reader's own order, not the registry's -- and the hidden
    // one still comes back, or nothing could ever put it back.
    expect(body.placements?.map(p => p.id)).toEqual(["p2", "p1"]);
  });

  it("serves a row whose ids collide, without leaking the repair onto the wire", async () => {
    // The repair is internal bookkeeping the service logs. A response that
    // carried it would make it public API by accident, and the next reader
    // would have to decide what it means.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(widget({ id: "core/b" }));
    stored = {
      version: 4,
      layout: serializeLayout([
        { id: "same", widgetId: "core/a", w: 12, h: 3, removed: false },
        { id: "same", widgetId: "core/b", w: 12, h: 3, removed: false },
      ]),
    };

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.source).toBe("own");
    expect(body.placements).toHaveLength(2);
    expect(new Set(body.placements?.map(p => p.id)).size).toBe(2);
    expect(body).not.toHaveProperty("duplicatePlacementIds");
  });

  it("drops a stored placement whose widget is gone, without saying so", async () => {
    registerWidget(widget({ id: "core/a" }));
    stored = {
      version: 1,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: false },
        {
          id: "p2",
          widgetId: "plugin/uninstalled",
          w: 12,
          h: 3,
          removed: false,
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

    // Says so, so the admin can tell the reader and ask before a save
    // replaces the row.
    expect(body.source).toBe("unreadable");
    expect(body.placements?.map(p => p.widgetId)).toEqual(["core/a"]);
    expect(logged).toEqual([{ unreadable: true }]);
    // The TRUE version, not 0. Reporting 0 would tell the client there is no
    // row, sending its next PUT down the insert path to collide with the row
    // that is still there -- turning a recoverable bad row into a dashboard
    // that can never be saved.
    expect(body.version).toBe(7);
  });
});

describe("where the add panel lists each widget", () => {
  it("says each widget's group, sub-group, description, category and sketch", async () => {
    registerWidget(
      widget({
        id: "core/team",
        title: "Team",
        description: "How many users and roles the project has.",
      })
    );
    setContributedWidgets([
      {
        id: "forms/latest",
        plugin: "@acme/forms",
        description: "The newest submissions.",
        category: "Forms",
        archetype: "list",
      },
    ]);

    const body = await bodyOf(await getWidgetLayout(getReq()));

    // Core's group, beside the sizes the editor already reads.
    expect(body.widgets?.["core/team"]).toMatchObject({
      group: "team",
      description: "How many users and roles the project has.",
      sketch: "custom",
      allowsSeveral: false,
    });
    expect(body.widgets?.["forms/latest"]).toMatchObject({
      group: "plugins",
      subgroup: "@acme/forms",
      description: "The newest submissions.",
      category: "Forms",
      sketch: "list",
    });
  });

  it("offers widgets in the panel's order: the built-ins, the site's own, Team, then each plugin's", async () => {
    // Registered in an order the panel must not follow.
    registerWidget(widget({ id: "site/zeta" }));
    registerWidget(widget({ id: "core/team" }));
    registerWidget(widget({ id: "core/recently-edited" }));
    registerWidget(widget({ id: "site/alpha" }));
    setContributedWidgets([{ id: "forms/latest", plugin: "@acme/forms" }]);
    // Something stored, so every widget is offered rather than placed.
    stored = { version: 1, layout: serializeLayout([]) };

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.available).toEqual([
      "core/recently-edited",
      "site/zeta",
      "site/alpha",
      "core/team",
      "forms/latest",
    ]);
  });

  it("ranks every offered widget in that order, a placed one too", async () => {
    // 🔴 `available` leaves out a placed widget that allows one card, but the panel still lists
    // it, as on the dashboard, and needs its place. Without a rank it could only guess one.
    registerWidget(widget({ id: "site/zeta" }));
    registerWidget(widget({ id: "core/team" }));
    registerWidget(widget({ id: "core/recently-edited" }));
    stored = {
      version: 1,
      layout: serializeLayout([
        { id: "p-team", widgetId: "core/team", w: 12, h: 3, removed: false },
      ]),
    };

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.available).not.toContain("core/team");
    const ranked = Object.entries(body.widgets ?? {})
      .filter(([, facts]) => typeof facts.rank === "number")
      .sort(([, a], [, b]) => (a.rank ?? 0) - (b.rank ?? 0))
      .map(([id]) => id);
    expect(ranked).toEqual(["core/recently-edited", "site/zeta", "core/team"]);
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
            w: 12,
            h: 3,
            removed: false,
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
        { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: false },
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

  it("starts each card at the default size it declared", async () => {
    setContributedWidgets([
      { id: "forms/latest", size: { default: { w: 8, h: 4 } } },
      { id: "forms/count", size: { default: { w: 3, h: 2 } } },
    ]);

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements?.map(p => [p.widgetId, p.w, p.h])).toEqual([
      ["forms/latest", 8, 4],
      ["forms/count", 3, 2],
    ]);
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
        { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: false },
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
        { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: false },
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
        { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: false },
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

/** A row a dismissal wrote: never arranged, so it still follows the defaults. */
function unarrangedRow(placements: WidgetPlacement[], version = 1) {
  return {
    version,
    layout: serializeLayout(placements, false),
  };
}

describe("a row nobody arranged still follows the defaults", () => {
  it("places a widget declared after a dismissal wrote the row", async () => {
    // 🔴 The freeze this exists to close. A dismissal writes a row without the
    // reader arranging anything, and the read used to treat any row as a
    // snapshot -- so one click on a card's dismiss control left every widget
    // declared afterwards merely OFFERED rather than placed. The arranged
    // case, where a later widget is correctly withheld, is the describe block
    // above: its rows are written as arrangements and it still passes.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(widget({ id: "core/new" }));
    stored = unarrangedRow([
      { id: "core/a", widgetId: "core/a", w: 12, h: 3, removed: true },
    ]);

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements?.map(p => p.widgetId).sort()).toEqual([
      "core/a",
      "core/new",
    ]);
    // Placed, so not offered as well: two answers to "is this on the
    // dashboard" in one response would disagree about the same card.
    expect(body.available).toEqual([]);
  });

  it("keeps a dismissed card dismissed when a new widget arrives", async () => {
    // Following the defaults must not undo what the reader DID do. The new
    // card arrives visible; the one they sent away stays sent away.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(widget({ id: "core/new" }));
    stored = unarrangedRow([
      { id: "core/a", widgetId: "core/a", w: 12, h: 3, removed: true },
    ]);

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements?.find(p => p.widgetId === "core/a")?.removed).toBe(
      true
    );
    expect(body.placements?.find(p => p.widgetId === "core/new")?.removed).toBe(
      false
    );
  });

  it("follows a change to the declared order", async () => {
    // Positions come from the live registry, not from the order the row was
    // written in. A snapshot taken from an earlier registry would otherwise
    // keep a card where a plugin has since stopped putting it -- and merging a
    // new widget into that snapshot could land it on a number an existing
    // placement already holds.
    registerWidget(widget({ id: "core/a", defaultOrder: 20 }));
    registerWidget(widget({ id: "core/b", defaultOrder: 10 }));
    stored = unarrangedRow([
      { id: "core/a", widgetId: "core/a", w: 12, h: 3, removed: false },
      { id: "core/b", widgetId: "core/b", w: 12, h: 3, removed: false },
    ]);

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements?.map(p => p.widgetId)).toEqual(["core/b", "core/a"]);
  });
});

describe("the kind of write a PUT is", () => {
  const onePlacement = (removed: boolean, id = "core/a"): WidgetPlacement[] => [
    { id, widgetId: "core/a", w: 12, h: 3, removed },
  ];

  it("records a dismissal on a reader with no row as unarranged", async () => {
    registerWidget(widget({ id: "core/a" }));

    await putWidgetLayout(
      putReq({
        placements: onePlacement(true),
        version: 0,
        scope: scopeFor(),
        arranged: false,
      })
    );

    expect(saved?.arranged).toBe(false);
  });

  it("keeps an arranged row arranged when a dismissal writes to it", async () => {
    // 🔴 MONOTONIC, and the case that matters most. A dismissal states `false`
    // because IT is not an arrangement; taken at its word against a row the
    // reader already arranged, it would demote their layout to the live
    // defaults and discard every move they ever made.
    registerWidget(widget({ id: "core/a" }));
    stored = {
      version: 3,
      layout: serializeLayout(onePlacement(false, "p1")),
    };

    await putWidgetLayout(
      putReq({
        placements: onePlacement(true, "p1"),
        version: 3,
        scope: scopeFor(),
        arranged: false,
      })
    );

    expect(saved?.arranged).toBe(true);
  });

  it("arranges a row a dismissal wrote, once the editor saves it", async () => {
    // The only way OUT of following the defaults, and it has to be reachable:
    // a reader who dismissed a card and then arranged their dashboard has taken
    // charge, whatever the row said before.
    registerWidget(widget({ id: "core/a" }));
    stored = unarrangedRow(onePlacement(true));

    await putWidgetLayout(
      putReq({
        placements: onePlacement(false),
        version: 1,
        scope: scopeFor(),
        arranged: true,
      })
    );

    expect(saved?.arranged).toBe(true);
  });

  it("treats a write that says nothing as an arrangement", async () => {
    // Every client written before a card could be dismissed from the dashboard
    // only ever wrote from the editor, so its silence keeps what it does today.
    registerWidget(widget({ id: "core/a" }));

    await putWidgetLayout(
      putReq({ placements: onePlacement(false), version: 0, scope: scopeFor() })
    );

    expect(saved?.arranged).toBe(true);
  });

  it("refuses a kind that is not a boolean, before writing anything", async () => {
    // Read for truthiness, "false" would freeze a reader out of every later
    // widget on the strength of a string saying the opposite.
    registerWidget(widget({ id: "core/a" }));

    const res = await putWidgetLayout(
      putReq({
        placements: onePlacement(false),
        version: 0,
        scope: scopeFor(),
        arranged: "false",
      })
    );

    expect(res.status).toBe(400);
    expect(saved).toBeUndefined();
  });

  it("carries a dismissal of a card the reader can no longer see", async () => {
    // Dismissals are applied to the WHOLE materialization before it is split
    // by visibility, so a card this reader dismissed and then lost access to
    // is carried through their next write still dismissed -- and comes back
    // dismissed the day access returns, rather than reappearing.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(
      widget({ id: "core/gated", requiredPermission: "read-secrets" })
    );
    stored = unarrangedRow([
      { id: "core/a", widgetId: "core/a", w: 12, h: 3, removed: false },
      {
        id: "core/gated",
        widgetId: "core/gated",
        w: 12,
        h: 3,
        removed: true,
      },
    ]);
    callerHoldsPermission.mockResolvedValue(false);

    await putWidgetLayout(
      putReq({
        placements: onePlacement(true, "core/a"),
        version: 1,
        scope: scopeFor(["core/a"]),
        arranged: false,
      })
    );

    expect(
      saved?.placements.find(p => p.widgetId === "core/gated")?.removed
    ).toBe(true);
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
                w: 12,
                h: 3,
                removed: false,
              },
            ],
            version: 0,
            scope: visibilityToken(["core/a"], []),
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
    { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: false },
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
        { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: false },
        {
          id: "p9",
          widgetId: "core/gated",
          w: 12,
          h: 3,
          removed: false,
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

  it("reads a retired per-collection card out of the row, and saves without it", async () => {
    // 🔴 Dropped, unlike the gated card above: core makes no card in the
    // `collection/` or `single/` namespace any more, so none can come back.
    // `acme/x`, a card of a plugin this install does not have now, is the
    // control: an unknown id is carried, so the drop is by namespace and not
    // by "the registry does not know it".
    registerWidget(widget({ id: "core/a" }));
    const row = serializeLayout([
      { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: false },
      {
        id: "p8",
        widgetId: "collection/posts-count",
        w: 3,
        h: 2,
        removed: false,
      },
      { id: "p9", widgetId: "acme/x", w: 12, h: 3, removed: false },
    ]);
    stored = { version: 2, layout: row };

    const read = await bodyOf(await getWidgetLayout(getReq()));
    expect(read.placements?.map(p => p.widgetId)).toEqual(["core/a"]);
    // The read writes nothing: the row is as it was until the next save.
    expect(saved).toBeUndefined();
    expect(stored?.layout).toBe(row);

    await putWidgetLayout(
      putReq({
        placements: onePlacement,
        version: 2,
        scope: scopeFor(["core/a"]),
      })
    );

    expect(saved?.placements.map(p => p.widgetId)).toEqual([
      "core/a",
      "acme/x",
    ]);
  });

  it("refuses a placement in a retired namespace, saying what replaced it in each", async () => {
    // The refusal is the namespace's, not the unknown-widget rule's: it says
    // what replaced the card, and for a Single never "that collection", since
    // the widgets with a Collection setting offer collections only.
    registerWidget(widget({ id: "core/a" }));
    const refused = async (widgetId: string) => {
      const res = await putWidgetLayout(
        putReq({
          placements: [
            ...onePlacement,
            { id: "p2", widgetId, w: 12, h: 3, removed: false },
          ],
          version: 0,
          scope: scopeFor(),
        })
      );
      expect(res.status).toBe(400);
      return res.text();
    };

    const collection = await refused("collection/posts-count");
    expect(collection).toContain(
      '\\"collection/posts-count\\" is a retired card: core no longer makes a card per collection. Add Count, Breakdown, Over time or Recent entries and set its Collection to posts.'
    );
    const single = await refused("single/about-card");
    expect(single).toContain(
      `\\"single/about-card\\" is a retired card: core no longer makes a card per Single. A Single's edits show in Recently edited (core/recently-edited).`
    );
    expect(single).not.toContain("Collection to");
    expect(saved).toBeUndefined();
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
          w: 12,
          h: 3,
          removed: false,
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
            w: 12,
            h: 3,
            removed: false,
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
          { id: "dup", widgetId: "core/a", w: 12, h: 3, removed: false },
          { id: "dup", widgetId: "core/a", w: 12, h: 3, removed: false },
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

  it("refuses two DIFFERENT widgets sharing one placement id", async () => {
    // The case above sends one widget twice, so it cannot tell a duplicate-id
    // rule from a duplicate-widget one. Two distinct, visible widgets isolate
    // the id as the reason.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(widget({ id: "core/b" }));

    const res = await putWidgetLayout(
      putReq({
        placements: [
          { id: "dup", widgetId: "core/a", w: 12, h: 3, removed: false },
          { id: "dup", widgetId: "core/b", w: 12, h: 3, removed: false },
        ],
        version: 0,
        scope: scopeFor(),
      })
    );

    expect(res.status).toBe(400);
    expect(saved).toBeUndefined();
  });

  it("ACCEPTS the same two widgets once their ids differ", async () => {
    // The control for the test above: everything else about that submission is
    // legal, so a refusal there is the id and nothing else.
    registerWidget(widget({ id: "core/a" }));
    registerWidget(widget({ id: "core/b" }));

    const res = await putWidgetLayout(
      putReq({
        placements: [
          { id: "one", widgetId: "core/a", w: 12, h: 3, removed: false },
          { id: "two", widgetId: "core/b", w: 12, h: 3, removed: false },
        ],
        version: 0,
        scope: scopeFor(),
      })
    );

    expect(res.status).toBe(200);
    expect(saved).toBeDefined();
  });

  it("keeps a resolved placement's id across the read/write round trip", async () => {
    /*
     * 🔴 The failure a freshly minted repair id would cause. A client echoes
     * the ids it was handed; if the id it was handed on GET is not the id this
     * PUT's own read produces, the card it sends back is no longer recognised
     * as the one it was shown, and a setting it kept is judged as a change.
     * The repair id is derived from the id it repeats, so both reads agree.
     */
    registerWidget(widget({ id: "core/a" }));
    registerWidget(widget({ id: "core/b" }));
    stored = {
      version: 4,
      layout: serializeLayout([
        { id: "same", widgetId: "core/a", w: 12, h: 3, removed: false },
        // A size outside core/b's bounds (12 by 3 exactly): kept as stored.
        { id: "same", widgetId: "core/b", w: 3, h: 2, removed: false },
      ]),
    };

    const body = await bodyOf(await getWidgetLayout(getReq()));
    const handed = body.placements ?? [];
    expect(new Set(handed.map(p => p.id)).size).toBe(2);
    const repaired = handed.find(p => p.widgetId === "core/b");
    expect(repaired?.id).not.toBe("same");

    const res = await putWidgetLayout(
      putReq({ placements: handed, version: 4, scope: body.scope })
    );

    expect(res.status).toBe(200);
    expect(saved?.placements.find(p => p.widgetId === "core/b")).toEqual(
      repaired
    );
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
        { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: false },
        {
          id: "p9",
          widgetId: "core/gated",
          w: 12,
          h: 3,
          removed: false,
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
            w: 12,
            h: 3,
            removed: false,
          },
        ],
        version: 0,
        scope: scopeFor(["core/a", "core/gated"]),
      })
    );

    expect(res.status).toBe(409);
    expect(saved).toBeUndefined();
  });

  it("refuses a write once the reader has gained a SHORTCUT'S permission, with the cards unchanged", async () => {
    // 🔴 The token is also what tells the admin its workspace payload is
    // stale, and that payload withholds the shortcuts a reader may not see. A
    // token of the ids alone stood still here -- the cards are the same
    // cards -- so the newly permitted shortcut stayed withheld until some
    // unrelated refresh. The view IS stale, and the guard says so.
    registerWidget(
      widget({
        id: "core/tools",
        archetype: "actions",
        component: undefined,
        actions: [
          { label: "Search", href: "/admin/search" },
          {
            label: "Publish",
            href: "/admin/publish",
            requiredPermission: "publish-notes",
          },
        ],
      })
    );
    // The client read while the shortcut's grant was absent...
    const before = scopeFor(["core/tools"]);
    // ...and holds it by the time the write arrives.
    callerHoldsPermission.mockResolvedValue(true);

    const res = await putWidgetLayout(
      putReq({
        placements: [
          {
            id: "p1",
            widgetId: "core/tools",
            w: 12,
            h: 3,
            removed: false,
          },
        ],
        version: 0,
        scope: before,
      })
    );

    expect(res.status).toBe(409);
    expect(saved).toBeUndefined();
    // The control: the token the reader would be handed NOW is accepted.
    const now = await bodyOf(await getWidgetLayout(getReq()));
    expect(now.scope).toBe(scopeFor(["core/tools"], ["publish-notes"]));
    expect(now.scope).not.toBe(before);
  });

  it("hands the same token to the same reader twice", async () => {
    // The other control: a token that moved on every read would refuse
    // every write.
    registerWidget(
      widget({
        id: "core/tools",
        archetype: "actions",
        component: undefined,
        actions: [
          { label: "Publish", href: "/x", requiredPermission: "publish-notes" },
        ],
      })
    );
    const first = await bodyOf(await getWidgetLayout(getReq()));
    const second = await bodyOf(await getWidgetLayout(getReq()));
    expect(first.scope).toBe(second.scope);
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
    expect(await res.json()).toMatchObject({
      error: {
        message: "Only a signed-in person can change a dashboard layout.",
      },
    });
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
            w: 12,
            h: 3,
            removed: false,
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
          w: 12,
          h: 3,
          removed: false,
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
          w: 12,
          h: 3,
          removed: false,
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

    // In the order a later read will draw it once the gate lifts: the array
    // order is the arrangement, and the carried card is back in its place.
    expect(saved?.placements.map(p => p.widgetId)).toEqual([
      "core/a",
      "core/gated",
      "core/b",
    ]);
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
          w: 12,
          h: 3,
          removed: false,
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
      w: 12,
      h: 3,
      removed: false,
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

/** A saved reset, naming the version and token it was staged against. */
function deleteReq(query: Record<string, string> = {}): Request {
  const params = new URLSearchParams(query);
  return new Request(`http://localhost/api/dashboard/layout?${params}`, {
    method: "DELETE",
  });
}

describe("DELETE /api/dashboard/layout", () => {
  it("removes the row, naming the version it was staged against", async () => {
    registerWidget(widget({ id: "core/a" }));
    stored = {
      version: 4,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: true },
      ]),
    };

    const res = await deleteWidgetLayout(
      deleteReq({ version: "4", scope: scopeFor() })
    );

    expect(res.status).toBe(200);
    // The service is what refuses a moved row, in its WHERE clause; this is
    // what it is asked to remove.
    expect(deleted).toEqual({ kind: "user", scope: "user-1", expected: 4 });
  });

  it("leaves the reader following the default, not a frozen copy", async () => {
    // 🔴 The reason this is a DELETE and not a PUT of the current default.
    // Writing a snapshot would freeze today's default into the row, so a
    // widget registered later would never reach this reader again.
    registerWidget(widget({ id: "core/a" }));
    stored = {
      version: 4,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: true },
      ]),
    };

    await deleteWidgetLayout(deleteReq({ version: "4", scope: scopeFor() }));

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

  it("refuses a reset staged against a different set of widgets, removing nothing", async () => {
    // 🔴 A stale tab's reset would otherwise delete an arrangement holding a
    // card that became visible after the tab read: the guard a save has.
    registerWidget(widget({ id: "core/a" }));
    stored = {
      version: 4,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/a", w: 12, h: 3, removed: false },
      ]),
    };

    const res = await deleteWidgetLayout(
      deleteReq({ version: "4", scope: scopeFor(["core/a", "core/new"]) })
    );

    expect(res.status).toBe(409);
    expect(deleted).toBeUndefined();
  });

  it("refuses a reset that names no version, or not a whole number", async () => {
    // Absent must not read as 0, "there is no row", which would let a reset
    // past a row the caller never read.
    const queries: Array<Record<string, string>> = [
      { scope: scopeFor() },
      { version: "", scope: scopeFor() },
      { version: "4.5", scope: scopeFor() },
      { version: "-1", scope: scopeFor() },
      { version: "four", scope: scopeFor() },
    ];
    for (const query of queries) {
      const res = await deleteWidgetLayout(deleteReq(query));
      expect(res.status).toBe(400);
    }
    expect(deleted).toBeUndefined();
  });

  it("refuses a reset that names no scope", async () => {
    const res = await deleteWidgetLayout(deleteReq({ version: "0" }));
    expect(res.status).toBe(400);
    expect(deleted).toBeUndefined();
  });

  it("refuses an API key", async () => {
    reqAuth.mockResolvedValue({
      userId: "user-1",
      permissions: [],
      roles: [],
      authMethod: "api-key",
    });

    const res = await deleteWidgetLayout(
      deleteReq({ version: "0", scope: scopeFor() })
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

describe("an arrangement the server could not read", () => {
  beforeEach(() => {
    registerWidget(widget({ id: "core/a" }));
    stored = { version: 7, layout: "{not json" };
  });

  const save = (extra: Record<string, unknown> = {}) =>
    putWidgetLayout(
      putReq({
        placements: [
          { id: "core/a", widgetId: "core/a", w: 12, h: 3, removed: false },
        ],
        version: 7,
        scope: scopeFor(),
        ...extra,
      })
    );

  it("is not replaced by a save the person did not confirm", async () => {
    const res = await save();
    expect(res.status).toBe(409);
    expect(saved).toBeUndefined();
    expect(stored?.layout).toBe("{not json");
  });

  it("is replaced by a save that confirms it", async () => {
    const res = await save({ replaceUnreadable: true });
    expect(res.status).toBe(200);
    expect(saved?.expected).toBe(7);
    expect(saved?.arranged).toBe(true);
  });

  it("refuses a single-card write outright, even one claiming confirmation", async () => {
    // A removal outside customise mode has nothing to merge into. Replacing
    // the row is only ever the person's confirmed save.
    const res = await save({ arranged: false, replaceUnreadable: true });
    expect(res.status).toBe(409);
    expect(saved).toBeUndefined();
  });

  it("refuses a confirmation that is not a boolean", async () => {
    const res = await save({ replaceUnreadable: "true" });
    expect(res.status).toBe(400);
    expect(saved).toBeUndefined();
  });

  it("CONTROL: a readable row needs no confirmation", async () => {
    stored = {
      version: 7,
      layout: serializeLayout([
        { id: "core/a", widgetId: "core/a", w: 12, h: 3, removed: false },
      ]),
    };
    expect((await save()).status).toBe(200);
  });
});

describe("a row of an earlier format", () => {
  const STARTED = "core/get-started";
  const open = {
    unknown: false,
    steps: [{ key: "invite", kind: "invite", status: "open" }],
    done: 0,
    total: 1,
  };
  /**
   * A version 3 row holding every field that format stored, each different
   * from the default: a moved and resized card, a removal, a setting, a
   * skipped Get started step and a card of a widget the default never places.
   */
  const EARLIER = JSON.stringify({
    schemaVersion: 3,
    placements: [
      {
        id: "mine-team",
        widgetId: "core/team",
        width: "quarter",
        removed: true,
        config: { range: "7d" },
      },
      {
        id: "mine-started",
        widgetId: STARTED,
        width: "half",
        removed: false,
        config: { skipped: ["invite"], acted: true },
      },
      { id: "mine-b", widgetId: "core/b", width: "third", removed: false },
    ],
  });
  const DEFAULT: WidgetPlacement[] = [
    { id: STARTED, widgetId: STARTED, w: 12, h: 3, removed: false },
    { id: "core/team", widgetId: "core/team", w: 12, h: 3, removed: false },
  ];

  beforeEach(() => {
    registerWidget(widget({ id: STARTED, defaultOrder: 0, dismissible: true }));
    registerWidget(widget({ id: "core/team", defaultOrder: 10 }));
    getStartedSteps.mockResolvedValue(open);
    stored = { version: 7, layout: EARLIER };
  });

  it("is read as the default, with the row's own version, and is not rewritten", async () => {
    const body = await bodyOf(await getWidgetLayout(getReq()));

    // 🔴 Exactly the default: none of the row's cards, sizes, settings,
    // removals or skips.
    expect(body.source).toBe("default");
    expect(body.placements).toEqual(DEFAULT);
    expect(body.defaultPlacements).toEqual(DEFAULT);
    // The row's version, so the next write replaces it rather than colliding.
    expect(body.version).toBe(7);
    // Not unreadable: nothing is logged and nothing asks for confirmation.
    expect(logged).toEqual([]);
    expect(saved).toBeUndefined();
    expect(stored?.layout).toBe(EARLIER);
  });

  const singleCardWrites: ReadonlyArray<
    [string, (placements: WidgetPlacement[]) => WidgetPlacement[]]
  > = [
    [
      "a removal",
      placements =>
        placements.map(p =>
          p.widgetId === "core/team" ? { ...p, removed: true } : p
        ),
    ],
    [
      "a quick setting",
      placements =>
        placements.map(p =>
          p.widgetId === "core/team" ? { ...p, config: { range: "30d" } } : p
        ),
    ],
    [
      "a skipped Get started step",
      placements =>
        placements.map(p =>
          p.widgetId === STARTED ? { ...p, config: { skipped: ["invite"] } } : p
        ),
    ],
  ];

  for (const [name, change] of singleCardWrites) {
    it(`is replaced by ${name}, as an absent row would be created, holding only the new state`, async () => {
      const body = await bodyOf(await getWidgetLayout(getReq()));
      const res = await putWidgetLayout(
        putReq({
          placements: change(body.placements ?? []),
          version: body.version,
          scope: body.scope,
          arranged: false,
        })
      );

      // 🔴 Accepted without asking, where an unreadable row refuses every
      // single-card write.
      expect(res.status).toBe(200);
      expect(saved?.expected).toBe(7);
      expect(saved?.arranged).toBe(false);
      // The default with the one change, and nothing of the earlier row.
      expect(saved?.placements).toEqual(change(DEFAULT));
    });
  }

  it("is replaced by a full save without a confirmation", async () => {
    const body = await bodyOf(await getWidgetLayout(getReq()));
    const res = await putWidgetLayout(
      putReq({
        placements: [...(body.placements ?? [])].reverse(),
        version: body.version,
        scope: body.scope,
      })
    );
    expect(res.status).toBe(200);
    expect(saved?.expected).toBe(7);
    expect(saved?.arranged).toBe(true);
    expect(saved?.placements).toEqual([...DEFAULT].reverse());
  });

  it("CONTROL: a row with no version, or a version this core never wrote, still refuses a single-card write", async () => {
    for (const schemaVersion of [undefined, 0, 99]) {
      saved = undefined;
      const layout = JSON.stringify({
        schemaVersion,
        placements: JSON.parse(EARLIER).placements,
      });
      stored = { version: 7, layout };
      const body = await bodyOf(await getWidgetLayout(getReq()));
      expect(body.source).toBe("unreadable");
      const res = await putWidgetLayout(
        putReq({
          placements: body.placements,
          version: body.version,
          scope: body.scope,
          arranged: false,
        })
      );
      expect(res.status).toBe(409);
      expect(saved).toBeUndefined();
      expect(stored?.layout).toBe(layout);
    }
  });
});

describe("the sizes a card may take", () => {
  const putOne = (size: Record<string, unknown>, version = 1) =>
    putWidgetLayout(
      putReq({
        placements: [
          { id: "p1", widgetId: "core/narrow", ...size, removed: false },
        ],
        version,
        scope: scopeFor(),
      })
    );

  beforeEach(() => {
    // From 4 by 2 to 8 by 4, starting at 6 by 3.
    registerWidget(
      widget({
        id: "core/narrow",
        size: {
          default: { w: 6, h: 3 },
          min: { w: 4, h: 2 },
          max: { w: 8, h: 4 },
        },
      })
    );
  });

  it("are not repeated in the widget facts: the admin reads them from the declaration", async () => {
    registerWidget(widget({ id: "core/any" }));
    const body = await bodyOf(await getWidgetLayout(getReq()));
    // Whether a second card may be added, and where the add panel lists each
    // one: neither is a built-in core knows, so both are the site's own,
    // under Overview.
    expect(body.widgets).toEqual({
      "core/narrow": {
        allowsSeveral: false,
        group: "overview",
        sketch: "custom",
        rank: 0,
      },
      "core/any": {
        allowsSeveral: false,
        group: "overview",
        sketch: "custom",
        rank: 1,
      },
    });
  });

  it("start a default card at its widget's default size", async () => {
    const body = await bodyOf(await getWidgetLayout(getReq()));
    expect(body.placements?.[0]).toMatchObject({ w: 6, h: 3 });
  });

  it("store a card resized within its widget's bounds as sent", async () => {
    stored = {
      version: 1,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/narrow", w: 6, h: 3, removed: false },
      ]),
    };
    expect((await putOne({ w: 8, h: 2 })).status).toBe(200);
    expect(saved?.placements[0]).toMatchObject({ w: 8, h: 2 });
  });

  it("store a size outside the widget's bounds as sent, rather than refuse or clamp it", async () => {
    // 🔴 The bounds are applied as a card is drawn, never on the way into the
    // row: a refused size would make an unrelated change to the dashboard
    // impossible to save, and a clamped one would lose the stored size the
    // day the widget's bounds widen again.
    stored = {
      version: 1,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/narrow", w: 6, h: 3, removed: false },
      ]),
    };
    expect((await putOne({ w: 12, h: 9 })).status).toBe(200);
    expect(saved?.placements[0]).toMatchObject({ w: 12, h: 9 });
  });

  it("keep a stored size outside the widget's bounds when it did not change", async () => {
    stored = {
      version: 1,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/narrow", w: 1, h: 2, removed: false },
      ]),
    };
    const body = await bodyOf(await getWidgetLayout(getReq()));
    // Handed as stored: drawing it within the bounds is the admin's.
    expect(body.placements?.[0]).toMatchObject({ w: 1, h: 2 });
    expect((await putOne({ w: 1, h: 2 })).status).toBe(200);
    expect(saved?.placements[0]).toMatchObject({ w: 1, h: 2 });
  });

  it("refuse a size the grid cannot draw, and write nothing", async () => {
    stored = {
      version: 1,
      layout: serializeLayout([
        { id: "p1", widgetId: "core/narrow", w: 6, h: 3, removed: false },
      ]),
    };
    for (const size of [
      { w: 13, h: 3 },
      { w: 0, h: 3 },
      { w: 6, h: 0 },
      { w: 6.5, h: 3 },
      { w: 6 },
    ]) {
      expect((await putOne(size)).status).toBe(400);
    }
    expect(saved).toBeUndefined();
  });
});

describe("widgets the reader may still add", () => {
  it("include a widget that allows several cards, even once one is placed", async () => {
    registerWidget(widget({ id: "core/one" }));
    setContributedWidgets([{ id: "forms/many", allowsSeveral: true }]);

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements?.map(p => p.widgetId)).toEqual([
      "forms/many",
      "core/one",
    ]);
    expect(body.available).toEqual(["forms/many"]);
  });
});

describe("a body in an earlier format", () => {
  it("is refused when it names a width rather than w and h, and nothing is written", async () => {
    registerWidget(widget({ id: "core/a" }));
    const res = await putWidgetLayout(
      putReq({
        placements: [
          { id: "core/a", widgetId: "core/a", width: "half", removed: false },
        ],
        version: 0,
        scope: scopeFor(),
      })
    );
    expect(res.status).toBe(400);
    expect(saved).toBeUndefined();
  });

  it("is refused, and nothing is written", async () => {
    // An admin built for the columns format sends column, order, hidden and
    // size. Stored half-understood, every card would lose its size.
    registerWidget(widget({ id: "core/a" }));
    const res = await putWidgetLayout(
      putReq({
        placements: [
          {
            id: "core/a",
            widgetId: "core/a",
            column: 0,
            order: 0,
            hidden: false,
            size: "md",
          },
        ],
        columnCount: 3,
        version: 0,
        scope: scopeFor(),
      })
    );
    expect(res.status).toBe(400);
    expect(saved).toBeUndefined();
  });
});

describe("cards the writer could not see, through a save", () => {
  it("go back after the card they followed, wherever that card moved", async () => {
    registerWidget(widget({ id: "core/a" }));
    registerWidget(widget({ id: "core/gated", requiredPermission: "secret" }));
    registerWidget(widget({ id: "core/b" }));
    stored = {
      version: 2,
      layout: serializeLayout([
        { id: "a", widgetId: "core/a", w: 12, h: 3, removed: false },
        { id: "g", widgetId: "core/gated", w: 6, h: 3, removed: false },
        { id: "b", widgetId: "core/b", w: 12, h: 3, removed: false },
      ]),
    };
    callerHoldsPermission.mockResolvedValue(false);

    const res = await putWidgetLayout(
      putReq({
        placements: [
          { id: "b", widgetId: "core/b", w: 12, h: 3, removed: false },
          { id: "a", widgetId: "core/a", w: 12, h: 3, removed: false },
        ],
        version: 2,
        scope: scopeFor(["core/a", "core/b"]),
      })
    );

    expect(res.status).toBe(200);
    expect(saved?.placements.map(p => p.id)).toEqual(["b", "a", "g"]);
    // And the reply names only what the caller sent.
    expect((await itemOf(res)).placements?.map(p => p.id)).toEqual(["b", "a"]);
  });
});

describe("the default dashboard, answered beside a reader's own", () => {
  it("is what a reader following the default would see, whatever they saved", async () => {
    // A staged reset draws it, and the admin must not work the default out
    // for itself: the server's one computation answers both.
    registerWidget(widget({ id: "core/a", defaultOrder: 0 }));
    registerWidget(
      widget({ id: "core/gated", defaultOrder: 5, requiredPermission: "x" })
    );
    registerWidget(
      widget({
        id: "core/b",
        defaultOrder: 10,
        size: { default: { w: 3, h: 2 } },
      })
    );
    stored = {
      version: 2,
      layout: serializeLayout([
        { id: "mine", widgetId: "core/b", w: 12, h: 3, removed: false },
      ]),
    };
    callerHoldsPermission.mockResolvedValue(false);

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements?.map(p => p.id)).toEqual(["mine"]);
    expect(body.defaultPlacements).toEqual([
      { id: "core/a", widgetId: "core/a", w: 12, h: 3, removed: false },
      { id: "core/b", widgetId: "core/b", w: 3, h: 2, removed: false },
    ]);
  });
});

describe("a widget that allows one card", () => {
  const two = (widgetId: string) => [
    { id: "a", widgetId, w: 12, h: 3, removed: false },
    { id: "b", widgetId, w: 12, h: 3, removed: false },
  ];

  it("is refused a second card", async () => {
    registerWidget(widget({ id: "core/one" }));
    const res = await putWidgetLayout(
      putReq({ placements: two("core/one"), version: 0, scope: scopeFor() })
    );
    expect(res.status).toBe(400);
    expect(saved).toBeUndefined();
  });

  it("still saves a row that already held two, so an older arrangement stays savable", async () => {
    registerWidget(widget({ id: "core/one" }));
    stored = {
      version: 1,
      layout: serializeLayout(two("core/one") as WidgetPlacement[]),
    };
    const res = await putWidgetLayout(
      putReq({ placements: two("core/one"), version: 1, scope: scopeFor() })
    );
    expect(res.status).toBe(200);
  });

  it("CONTROL: a widget that allows several takes a second card", async () => {
    setContributedWidgets([{ id: "forms/many", allowsSeveral: true }]);
    const res = await putWidgetLayout(
      putReq({
        placements: two("forms/many"),
        version: 0,
        scope: scopeFor(["forms/many"]),
      })
    );
    expect(res.status).toBe(200);
  });
});

describe("the Get started card in the layout read and write", () => {
  const STARTED = "core/get-started";
  const open = {
    unknown: false,
    steps: [{ key: "invite", kind: "invite", status: "open" }],
    done: 0,
    total: 1,
  };
  const finished = {
    unknown: false,
    steps: [{ key: "invite", kind: "invite", status: "done" }],
    done: 1,
    total: 1,
  };
  const startedCard = (
    patch: Partial<WidgetPlacement> = {}
  ): WidgetPlacement => ({
    id: "started",
    widgetId: STARTED,
    w: 12,
    h: 3,
    removed: false,
    ...patch,
  });
  const teamCard: WidgetPlacement = {
    id: "team",
    widgetId: "core/team",
    w: 12,
    h: 3,
    removed: false,
  };
  const getStartedReq = () =>
    new Request("http://localhost/api/dashboard/layout?getStarted=1");

  beforeEach(() => {
    registerWidget(widget({ id: STARTED, defaultOrder: 0, dismissible: true }));
    registerWidget(widget({ id: "core/team", defaultOrder: 10 }));
  });

  type WithStarted = LayoutPayload & {
    getStarted?: { drawn: boolean; answer: unknown };
  };

  it("draws the card first in the default while a step is waiting, with the steps that decided it", async () => {
    getStartedSteps.mockResolvedValue(open);
    const body = (await bodyOf(await getWidgetLayout(getReq()))) as WithStarted;
    expect(body.placements?.map(p => p.widgetId)).toEqual([
      STARTED,
      "core/team",
    ]);
    expect(body.defaultPlacements?.map(p => p.widgetId)).toEqual([
      STARTED,
      "core/team",
    ]);
    expect(body.getStarted).toEqual({ drawn: true, answer: open });
  });

  it("answers the default from the steps when asked, though the arrangement holds no card of its own", async () => {
    // 🔴 Worked out only for the reader's own card, the default left the card
    // out for an arrangement without one, and a staged reset previewed a
    // dashboard the reset would not land on.
    getStartedSteps.mockResolvedValue(open);
    stored = { layout: serializeLayout([teamCard]), version: 3 };
    const plain = (await bodyOf(
      await getWidgetLayout(getReq())
    )) as WithStarted;
    expect(plain.defaultPlacements?.map(p => p.widgetId)).toEqual([
      "core/team",
    ]);
    const asked = (await bodyOf(
      await getWidgetLayout(getStartedReq())
    )) as WithStarted;
    expect(asked.defaultPlacements?.map(p => p.widgetId)).toEqual([
      STARTED,
      "core/team",
    ]);
    // The reader's own arrangement is unchanged by the asking.
    expect(asked.placements?.map(p => p.widgetId)).toEqual(["core/team"]);
  });

  it("leaves a finished card dormant for a reader who never acted on it, and never offers it in the add panel", async () => {
    getStartedSteps.mockResolvedValue(finished);
    const body = (await bodyOf(await getWidgetLayout(getReq()))) as WithStarted;
    expect(body.placements?.map(p => p.widgetId)).toEqual(["core/team"]);
    expect(body.defaultPlacements?.map(p => p.widgetId)).toEqual(["core/team"]);
    expect(body.available).not.toContain(STARTED);
    expect(body.getStarted?.drawn).toBe(false);
  });

  it("keeps a finished card drawn, as all set, for a reader who acted on it", async () => {
    getStartedSteps.mockResolvedValue(finished);
    stored = {
      layout: serializeLayout([
        startedCard({ config: { acted: true } }),
        teamCard,
      ]),
      version: 3,
    };
    const body = (await bodyOf(await getWidgetLayout(getReq()))) as WithStarted;
    expect(body.placements?.map(p => p.widgetId)).toEqual([
      STARTED,
      "core/team",
    ]);
    expect(body.getStarted?.drawn).toBe(true);
  });

  it("works out no steps for a removed card, lists it for Removed, and answers them when asked", async () => {
    getStartedSteps.mockResolvedValue(open);
    stored = {
      layout: serializeLayout([startedCard({ removed: true }), teamCard]),
      version: 3,
    };
    const body = (await bodyOf(await getWidgetLayout(getReq()))) as WithStarted;
    expect(body.placements?.find(p => p.widgetId === STARTED)?.removed).toBe(
      true
    );
    expect(body.getStarted).toEqual({ drawn: false, answer: null });
    expect(getStartedSteps).not.toHaveBeenCalled();

    const asked = (await bodyOf(
      await getWidgetLayout(getStartedReq())
    )) as WithStarted;
    expect(asked.getStarted).toEqual({ drawn: false, answer: open });
  });

  it("keeps the visibility token whatever the steps say, so a skip or a dismissal is never refused as stale", async () => {
    getStartedSteps.mockResolvedValue(open);
    const before = await bodyOf(await getWidgetLayout(getReq()));
    getStartedSteps.mockResolvedValue(finished);
    const after = await bodyOf(await getWidgetLayout(getReq()));
    expect(after.scope).toBe(before.scope);
  });

  it("carries a dormant card, with its settings, in place through a save that never held it", async () => {
    getStartedSteps.mockResolvedValue(finished);
    // Dormant: finished, never acted on, nothing skipped; its settings still
    // belong to the reader.
    const kept = startedCard({ config: { note: "kept" } });
    stored = { layout: serializeLayout([kept, teamCard]), version: 3 };
    const read = await bodyOf(await getWidgetLayout(getReq()));
    await putWidgetLayout(
      putReq({
        placements: read.placements,
        version: 3,
        scope: read.scope,
      })
    );
    // 🔴 Replaced as a visible card, it was deleted with its skips, because
    // the reader's snapshot could not hold a card they were never handed.
    expect(saved?.placements).toEqual([kept, teamCard]);
  });

  it("replaces the card as usual when the save holds it", async () => {
    getStartedSteps.mockResolvedValue(open);
    stored = { layout: serializeLayout([startedCard(), teamCard]), version: 3 };
    const read = await bodyOf(await getWidgetLayout(getReq()));
    const acted = startedCard({ config: { acted: true } });
    await putWidgetLayout(
      putReq({ placements: [acted, teamCard], version: 3, scope: read.scope })
    );
    expect(saved?.placements).toEqual([acted, teamCard]);
  });
});

describe("a card's note", () => {
  const noteWidget = () =>
    widget({
      id: "core/notes",
      settings: [
        { name: "text", label: "Note", type: "textarea", maxLength: 5 },
      ],
    });
  const placed = (text: string) => [
    {
      id: "n",
      widgetId: "core/notes",
      w: 12,
      h: 3,
      removed: false,
      config: { text },
    },
  ];

  it("is refused over the length its widget declares, and nothing is saved", async () => {
    registerWidget(noteWidget());
    const res = await putWidgetLayout(
      putReq({ placements: placed("hello!"), version: 0, scope: scopeFor() })
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(
      '\\"Note\\" is at most 5 characters'
    );
    expect(saved).toBeUndefined();
  });

  it("is counted in characters, so five that take ten UTF-16 units fit", async () => {
    // 🔴 The must-differ case: a bound counted by `length` refuses this.
    registerWidget(noteWidget());
    const res = await putWidgetLayout(
      putReq({
        placements: placed("😀😀😀😀😀"),
        version: 0,
        scope: scopeFor(),
      })
    );
    expect(res.status).toBe(200);
  });

  /** A plugin contributing `acme/notes`, a card with a five-character note, through its manifest alone. */
  const contributedNotes = () =>
    contributedWidgetSummaries([
      {
        name: "@acme/notes",
        contributes: {
          admin: {
            widgets: [
              {
                id: "acme/notes",
                title: "Notes",
                archetype: "metric",
                size: { default: { w: 12, h: 3 } },
                query: { source: "collection:posts", op: "count" },
                settings: [
                  {
                    name: "text",
                    label: "Note",
                    type: "textarea",
                    maxLength: 5,
                  },
                ],
              },
            ],
          },
        },
      } as unknown as PluginDefinition,
    ]);
  const placedOn = (widgetId: string, text: string) =>
    placed(text).map(placement => ({ ...placement, widgetId }));

  it("is refused on a widget a plugin contributes, which no registry holds", async () => {
    const summaries = contributedNotes();
    // The control: the summary reached the canonical set with its bound, so
    // a refusal below is the bound's, not an unknown widget's.
    expect(summaries.map(summary => summary.textBounds)).toEqual([
      [{ name: "text", label: "Note", maxLength: 5 }],
    ]);
    setContributedWidgets(summaries);
    // The reader sees the contributed widget beside the registry's.
    const scope = scopeFor([...listWidgets().map(w => w.id), "acme/notes"]);

    // 🔴 Bounded by the registry alone, this was saved: a contribution's
    // settings never reach it.
    const refused = await putWidgetLayout(
      putReq({
        placements: placedOn("acme/notes", "hello!"),
        version: 0,
        scope,
      })
    );
    expect(refused.status).toBe(400);
    expect(JSON.stringify(await refused.json())).toContain(
      '\\"Note\\" is at most 5 characters'
    );
    expect(saved).toBeUndefined();

    // The must-differ half: within the bound, it saves.
    const accepted = await putWidgetLayout(
      putReq({
        placements: placedOn("acme/notes", "hello"),
        version: 0,
        scope,
      })
    );
    expect(accepted.status).toBe(200);
  });

  it("keeps a contribution's bound when a registration of the same id states no settings", async () => {
    // The admin's rule: the registration's settings wherever it states any,
    // else the contribution's, so the sheet still bounds this note.
    setContributedWidgets(contributedNotes());
    registerWidget(widget({ id: "acme/notes" }));
    const res = await putWidgetLayout(
      putReq({
        placements: placedOn("acme/notes", "hello!"),
        version: 0,
        scope: scopeFor(),
      })
    );
    expect(res.status).toBe(400);
  });

  it("takes a registration's bound over a contribution's when it states settings", async () => {
    setContributedWidgets(contributedNotes());
    registerWidget(
      widget({
        id: "acme/notes",
        settings: [
          { name: "text", label: "Note", type: "textarea", maxLength: 10 },
        ],
      })
    );
    // Over the contribution's five, within the registration's ten.
    const res = await putWidgetLayout(
      putReq({
        placements: placedOn("acme/notes", "hello!"),
        version: 0,
        scope: scopeFor(),
      })
    );
    expect(res.status).toBe(200);
  });

  it("refuses a card a plugin's widget sets to a collection the reader may not read", async () => {
    const summaries = contributedWidgetSummaries([
      {
        name: "@acme/pinned",
        contributes: {
          admin: {
            widgets: [
              {
                id: "acme/pinned",
                title: "Pinned",
                archetype: "metric",
                size: { default: { w: 12, h: 3 } },
                query: { source: "collection:posts", op: "count" },
                settings: [
                  { name: "source", label: "Collection", type: "collection" },
                ],
              },
            ],
          },
        },
      } as unknown as PluginDefinition,
    ]);
    // The control: the contribution's Collection setting reached the summary,
    // so the refusal below is the collection's, not an unknown widget's.
    expect(summaries.map(summary => summary.collectionSetting?.name)).toEqual([
      "source",
    ]);
    setContributedWidgets(summaries);
    // 🔴 Judged by the registry alone, a contributed widget's card was never
    // judged at all: no registry holds it.
    const res = await putWidgetLayout(
      putReq({
        placements: [
          {
            id: "p",
            widgetId: "acme/pinned",
            w: 12,
            h: 3,
            removed: false,
            config: { source: "secret" },
          },
        ],
        version: 0,
        scope: visibilityToken(
          [...listWidgets().map(w => w.id), "acme/pinned"],
          [],
          [],
          collectionSettingsToken(summaries)
        ),
      })
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain(
      "collection that is not available"
    );
  });

  it("still saves a note it already held, written before the bound was lowered", async () => {
    registerWidget(noteWidget());
    stored = {
      version: 1,
      layout: serializeLayout(placed("longer than five") as WidgetPlacement[]),
    };
    const res = await putWidgetLayout(
      putReq({
        placements: placed("longer than five"),
        version: 1,
        scope: scopeFor(),
      })
    );
    expect(res.status).toBe(200);
  });

  it("holds an id reused for a note to the note's bound, whatever the card under it held", async () => {
    // A card of a widget with no bound held this text under the same id.
    registerWidget(noteWidget());
    registerWidget(widget({ id: "core/plain" }));
    stored = {
      version: 1,
      layout: serializeLayout(
        placed("longer than five").map(placement => ({
          ...placement,
          widgetId: "core/plain",
        })) as WidgetPlacement[]
      ),
    };
    // 🔴 Compared by value alone, the text is "unchanged" and the bound is
    // skipped: the note is saved over its length.
    const res = await putWidgetLayout(
      putReq({
        placements: placed("longer than five"),
        version: 1,
        scope: scopeFor(),
      })
    );
    expect(res.status).toBe(400);
    expect(saved).toBeUndefined();
  });
});

describe("the one default", () => {
  const plan = (patch: Partial<DefaultLayoutPlan>) =>
    setDefaultLayoutPlan({
      cards: [],
      suggestions: true,
      suggested: [],
      ...patch,
    });

  it("is the site's defaultLayout, in its order, at its sizes and with its settings", async () => {
    registerWidget(widget({ id: "site/a" }));
    registerWidget(widget({ id: "site/b" }));
    plan({
      cards: [
        { widget: "site/b", w: 6, h: 4, settings: { top: 5 } },
        { widget: "site/a" },
      ],
      suggestions: false,
    });

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements).toEqual([
      {
        id: "site/b",
        widgetId: "site/b",
        w: 6,
        h: 4,
        removed: false,
        config: { top: 5 },
      },
      { id: "site/a", widgetId: "site/a", w: 12, h: 3, removed: false },
    ]);
    expect(body.defaultPlacements).toEqual(body.placements);
  });

  it("differs between two people with different permissions only by the cards one may not see", async () => {
    registerWidget(widget({ id: "site/a" }));
    registerWidget(
      widget({ id: "site/gated", requiredPermission: "read-secrets" })
    );
    registerWidget(widget({ id: "site/b" }));
    plan({
      cards: [
        { widget: "site/gated" },
        { widget: "site/a" },
        { widget: "site/b" },
      ],
    });

    const granted = await bodyOf(await getWidgetLayout(getReq()));
    callerHoldsPermission.mockResolvedValue(false);
    const refused = await bodyOf(await getWidgetLayout(getReq()));

    expect(granted.placements?.map(p => p.widgetId)).toEqual([
      "site/gated",
      "site/a",
      "site/b",
    ]);
    expect(refused.placements).toEqual(
      granted.placements?.filter(p => p.widgetId !== "site/gated")
    );
  });

  it("places a plugin's suggestion on the default, never on a saved dashboard, where it is offered", async () => {
    registerWidget(widget({ id: "site/a" }));
    registerWidget(widget({ id: "acme/suggested" }));
    plan({ cards: [{ widget: "site/a" }], suggested: ["acme/suggested"] });
    stored = {
      version: 2,
      layout: serializeLayout([
        { id: "p1", widgetId: "site/a", w: 12, h: 3, removed: false },
      ]),
    };

    const body = await bodyOf(await getWidgetLayout(getReq()));

    expect(body.placements?.map(p => p.widgetId)).toEqual(["site/a"]);
    expect(body.available).toContain("acme/suggested");
    expect(body.defaultPlacements?.map(p => p.widgetId)).toEqual([
      "site/a",
      "acme/suggested",
    ]);
  });

  it("leaves out a card its declared widget would not show this reader, and carries it into the first save", async () => {
    registerWidget(widget({ id: "site/a" }));
    registerWidget(widget({ id: "acme/quiet" }));
    plan({ cards: [{ widget: "acme/quiet" }, { widget: "site/a" }] });
    defaultCardsNotShown.mockResolvedValue(new Set(["acme/quiet"]));

    const body = await bodyOf(await getWidgetLayout(getReq()));
    expect(body.placements?.map(p => p.widgetId)).toEqual(["site/a"]);
    expect(body.defaultPlacements?.map(p => p.widgetId)).toEqual(["site/a"]);
    // Asked of the default's cards the reader's view lets them see.
    expect(defaultCardsNotShown).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      [
        expect.objectContaining({ widgetId: "acme/quiet" }),
        expect.objectContaining({ widgetId: "site/a" }),
      ],
      expect.any(AbortSignal)
    );

    await putWidgetLayout(
      putReq({
        placements: [
          { id: "site/a", widgetId: "site/a", w: 12, h: 3, removed: false },
        ],
        version: 0,
        scope: body.scope,
      })
    );
    // Kept in the row, where the day it is shown it comes back.
    expect(saved?.placements.map(p => p.widgetId)).toEqual([
      "acme/quiet",
      "site/a",
    ]);
  });

  it("refuses a reset staged before a card of the default changed its verdict, which would reset to a dashboard nobody saw", async () => {
    registerWidget(widget({ id: "site/a" }));
    registerWidget(widget({ id: "acme/quiet" }));
    plan({ cards: [{ widget: "acme/quiet" }, { widget: "site/a" }] });
    stored = {
      version: 2,
      layout: serializeLayout([
        { id: "p1", widgetId: "site/a", w: 12, h: 3, removed: false },
      ]),
    };
    defaultCardsNotShown.mockResolvedValue(new Set(["acme/quiet"]));
    const staged = await bodyOf(await getWidgetLayout(getReq()));
    // The default the reset was staged against left the card out.
    expect(staged.defaultPlacements?.map(p => p.widgetId)).toEqual(["site/a"]);
    defaultCardsNotShown.mockResolvedValue(new Set());

    const res = await deleteWidgetLayout(
      deleteReq({ version: "2", scope: staged.scope ?? "" })
    );

    expect(res.status).toBe(409);
    expect(deleted).toBeUndefined();
  });

  it("leaves a saved dashboard's cards as the reader arranged them", async () => {
    registerWidget(widget({ id: "acme/quiet" }));
    plan({ cards: [{ widget: "acme/quiet" }] });
    defaultCardsNotShown.mockResolvedValue(new Set(["acme/quiet"]));
    stored = {
      version: 2,
      layout: serializeLayout([
        {
          id: "acme/quiet",
          widgetId: "acme/quiet",
          w: 12,
          h: 3,
          removed: false,
        },
      ]),
    };

    const body = await bodyOf(await getWidgetLayout(getReq()));

    // The card answers for itself; the default handed for a reset leaves it out.
    expect(body.placements?.map(p => p.widgetId)).toEqual(["acme/quiet"]);
    expect(body.defaultPlacements).toEqual([]);
  });

  it("refuses a first save staged before a card's own rule changed its verdict, which would drop the card", async () => {
    registerWidget(widget({ id: "site/a" }));
    registerWidget(widget({ id: "acme/quiet" }));
    plan({ cards: [{ widget: "acme/quiet" }, { widget: "site/a" }] });
    defaultCardsNotShown.mockResolvedValue(new Set(["acme/quiet"]));
    const handed = await bodyOf(await getWidgetLayout(getReq()));
    // Shown from now on: the save below never held it.
    defaultCardsNotShown.mockResolvedValue(new Set());

    const res = await putWidgetLayout(
      putReq({
        placements: handed.placements,
        version: 0,
        scope: handed.scope,
      })
    );

    expect(res.status).toBe(409);
    expect(saved).toBeUndefined();
    // The reset checks the same token, and a fresh read's is accepted.
    const fresh = await bodyOf(await getWidgetLayout(getReq()));
    expect(fresh.scope).not.toBe(handed.scope);
    const reset = await deleteWidgetLayout(
      deleteReq({ version: "0", scope: fresh.scope ?? "" })
    );
    expect(reset.status).toBe(200);
  });

  it("judges a card of a row following the default with the settings the row gave it", async () => {
    registerWidget(widget({ id: "site/a" }));
    registerWidget(widget({ id: "acme/quiet" }));
    plan({
      cards: [
        { widget: "acme/quiet", settings: { hide: false } },
        { widget: "site/a" },
      ],
    });
    // The card's own rule reads its setting.
    defaultCardsNotShown.mockImplementation(
      async (
        _auth: unknown,
        _reader: unknown,
        placements: readonly WidgetPlacement[]
      ) =>
        new Set(
          placements
            .filter(placement => placement.config?.hide === true)
            .map(placement => placement.id)
        )
    );
    stored = unarrangedRow([
      {
        id: "acme/quiet",
        widgetId: "acme/quiet",
        w: 12,
        h: 3,
        removed: false,
        config: { hide: true },
      },
    ]);

    const body = await bodyOf(await getWidgetLayout(getReq()));

    // Drawn with the stored setting, so judged with it.
    expect(body.placements?.map(p => p.widgetId)).toEqual(["site/a"]);
    // The default a reset returns to keeps its own setting, and the card.
    expect(body.defaultPlacements?.map(p => p.widgetId)).toEqual([
      "acme/quiet",
      "site/a",
    ]);
  });

  it("hands a reader who may not see the first card the second under its own id, whatever another reader sees", async () => {
    registerWidget(widget({ id: "site/many", allowsSeveral: true }));
    plan({
      cards: [
        { widget: "site/many", settings: { top: 5 } },
        { widget: "site/many", id: "many-2", settings: { top: 10 } },
      ],
      suggestions: false,
    });
    defaultCardsNotShown.mockResolvedValue(new Set(["site/many"]));
    const withheld = await bodyOf(await getWidgetLayout(getReq()));
    defaultCardsNotShown.mockResolvedValue(new Set());
    const shown = await bodyOf(await getWidgetLayout(getReq()));

    // The second card is "many-2" either way: its id says nothing of the first.
    expect(withheld.placements?.map(p => p.id)).toEqual(["many-2"]);
    expect(shown.placements?.map(p => p.id)).toEqual(["site/many", "many-2"]);
  });

  it("answers a setting change with the token the next write is checked against", async () => {
    registerWidget(widget({ id: "site/a" }));
    registerWidget(widget({ id: "acme/quiet" }));
    plan({
      cards: [
        { widget: "acme/quiet", settings: { hide: false } },
        { widget: "site/a" },
      ],
    });
    // The card's own rule reads its setting.
    defaultCardsNotShown.mockImplementation(
      async (
        _auth: unknown,
        _reader: unknown,
        placements: readonly WidgetPlacement[]
      ) =>
        new Set(
          placements
            .filter(placement => placement.config?.hide === true)
            .map(placement => placement.id)
        )
    );
    const handed = await bodyOf(await getWidgetLayout(getReq()));
    const [quiet, a] = handed.placements ?? [];

    // Outside customise mode, a setting its own rule reads: the card is now
    // one this reader is not shown.
    const first = await itemOf(
      await putWidgetLayout(
        putReq({
          placements: [{ ...quiet, config: { hide: true } }, a],
          version: 0,
          scope: handed.scope,
          arranged: false,
        })
      )
    );
    stored = unarrangedRow(saved?.placements ?? []);
    saved = undefined;

    const second = await putWidgetLayout(
      putReq({
        placements: [{ ...a, removed: true }],
        version: first.version,
        scope: first.scope,
        arranged: false,
      })
    );
    expect(second.status).toBe(200);
    expect(saved).toBeDefined();
  });

  it("keeps two cards of one widget apart through a save, each with its own settings and removal", async () => {
    registerWidget(widget({ id: "site/many", allowsSeveral: true }));
    plan({
      cards: [
        { widget: "site/many", settings: { top: 5 } },
        { widget: "site/many", id: "many-2", settings: { top: 10 } },
      ],
      suggestions: false,
    });

    const handed = await bodyOf(await getWidgetLayout(getReq()));
    // Two cards, two identities: one id would make them one card to the admin.
    expect(handed.placements?.map(p => p.id)).toEqual(["site/many", "many-2"]);

    // A change to the second card alone, outside customise mode: the row
    // still follows the default.
    const [first, second] = handed.placements ?? [];
    await putWidgetLayout(
      putReq({
        placements: [first, { ...second, config: { top: 20 } }],
        version: 0,
        scope: scopeFor(),
        arranged: false,
      })
    );
    stored = unarrangedRow(saved?.placements ?? []);
    const afterChange = await bodyOf(await getWidgetLayout(getReq()));
    expect(afterChange.placements?.map(p => p.config)).toEqual([
      { top: 5 },
      { top: 20 },
    ]);

    // Then the first removed: the second stays.
    await putWidgetLayout(
      putReq({
        placements: [
          { ...afterChange.placements?.[0], removed: true },
          afterChange.placements?.[1],
        ],
        version: 1,
        scope: scopeFor(),
        arranged: false,
      })
    );
    stored = unarrangedRow(saved?.placements ?? [], 2);
    const afterRemoval = await bodyOf(await getWidgetLayout(getReq()));
    expect(
      afterRemoval.placements?.map(p => [p.id, p.removed, p.config])
    ).toEqual([
      ["site/many", true, { top: 5 }],
      ["many-2", false, { top: 20 }],
    ]);
  });
});
