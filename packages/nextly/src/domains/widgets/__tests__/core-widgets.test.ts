/**
 * The core cards' declarations, held against the modules that have to honour
 * them.
 *
 * Deliberately NOT a restatement of the list. Asserting that a card carries the
 * literal written three lines away in `core-widgets/` is a test that can only
 * ever agree with itself, and it would go on agreeing while the thing the
 * literal REFERS to was renamed underneath it. What is checked here is each
 * declaration against the module that consumes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetWidgetRegistries } from "../../../di/registrations/register-widgets";
import * as loggerModule from "../../../observability/logger";
import { parsePermissionSlug } from "../../../plugins/routes/permission-slug";
import { RELEASES_RESOURCE } from "../../releases/services/releases-service";
import { CORE_DECLARATIONS, CORE_WIDGETS } from "../core-widgets";
import { teamWidget } from "../core-widgets/team";
import { CORE_DEFAULT_LAYOUT, CORE_WIDGET_IDS } from "../core-widgets/ids";
import {
  chromeFieldProblem,
  requiredPermissionSlugs,
  validateWidgetDefinition,
  type WidgetDefinition,
} from "../definition";
import { sizeBounds, sizeDeclarationProblems } from "../grid-size";
import { DENSITY_OPTIONS } from "../declaration/setting-builders";
import { LIST_DENSITIES, MAX_WIDGET_ROWS } from "../query-limits";
import { getWidget } from "../registry";
import { TEAM_GATE } from "../team-gate";

beforeEach(() => {
  vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
  // Every core widget as core publishes it, declarations and definitions alike: what the add
  // panel, the layout and the admin read.
  resetWidgetRegistries([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A core widget as core publishes it, whether it is declared or still a definition. */
function card(id: string): WidgetDefinition {
  const found = getWidget(id);
  // Resolved through a lookup that REFUSES rather than through `!`, so a
  // renamed or removed card fails here naming itself, instead of every
  // assertion below reading `undefined` and reporting something unrelated.
  if (!found) throw new Error(`no core widget with id "${id}"`);
  return found;
}

/** Every core widget as core publishes it, in core's order. */
const published = () => CORE_WIDGET_IDS.map(card);

/** A core widget's declared size, whether it is a definition or a declaration. */
function sizeOf(id: string) {
  const declared = CORE_DECLARATIONS.find(widget => widget.id === id);
  return declared === undefined ? card(id).size : declared.size;
}

describe("core widget definitions", () => {
  /*
   * Every card goes through the same door a plugin's does. Core's list is a
   * hand-written literal that no caller validates on the way in -- boot calls
   * `registerWidget`, which validates, but a definition that would be REFUSED
   * there fails at boot rather than in a test naming the field.
   */
  it.each(CORE_WIDGETS.map(widget => [widget.id, widget] as const))(
    "%s is a valid definition",
    (_id, widget) => {
      // An assertion function: it THROWS with a named reason and returns
      // nothing, so the absence of a throw is the whole result.
      expect(() => validateWidgetDefinition(widget)).not.toThrow();
    }
  );

  it.each(CORE_WIDGET_IDS.map(id => [id] as const))(
    "%s is never sized below two rows",
    id => {
      // One row cannot hold the frame's padding, header and gap, so a card
      // declared at one row draws a header with no body under it.
      expect(sizeDeclarationProblems(sizeOf(id))).toEqual([]);
      const { min } = sizeBounds(sizeOf(id));
      expect(min.h).toBeGreaterThanOrEqual(2);
    }
  );

  /*
   * 🔴 The load-bearing one. `core/upcoming-releases` is gated by a permission
   * SLUG -- a string this file spells out -- and the gate only works if that
   * string parses to the action and resource `ReleasesService` actually
   * enforces. Two independent renames break it silently and in the dangerous
   * direction: a slug that parses to a resource nothing grants is refused for
   * everyone, and the card simply never appears, which looks exactly like a
   * reader without the permission.
   *
   * Compared against `RELEASES_RESOURCE` rather than against the literal
   * "content-releases", so renaming the resource fails here instead of leaving
   * a card gated on a resource that no longer exists.
   */
  it("gates upcoming releases on the resource the releases service enforces", () => {
    const slugs = requiredPermissionSlugs(
      card("core/upcoming-releases").requiredPermission
    );

    // Read through the gate's own reader, so a declaration this test approves
    // is one the gate can actually use.
    expect(slugs).toBeDefined();
    expect((slugs ?? []).map(parsePermissionSlug)).toEqual([
      { action: "read", resource: RELEASES_RESOURCE },
      { action: "create", resource: RELEASES_RESOURCE },
      { action: "publish", resource: RELEASES_RESOURCE },
    ]);
  });

  /*
   * 🔴 The authorities, held against the RULE rather than against a list.
   * `ReleasesService.authorize` returns early for `create` or `publish` when the
   * authority asked for is `read`, so those two are what the card must also
   * admit. Asserted by exercising that implication -- a card gated on read alone
   * would satisfy the test above and still hide from a create-only editor, which
   * is precisely the defect this replaced.
   */
  it("admits every authority the service treats as satisfying read", () => {
    const slugs = new Set(
      requiredPermissionSlugs(card("core/upcoming-releases").requiredPermission)
    );

    for (const action of ["read", "create", "publish"]) {
      expect(
        slugs.has(`${action}-${RELEASES_RESOURCE}`),
        `a role holding only ${action}-${RELEASES_RESOURCE} can read releases, so the card must admit it`
      ).toBe(true);
    }
  });

  /*
   * The other cards' lack of a gate is a decision rather than an omission -- see
   * the module docblock -- so it is asserted, not assumed. A gate added to one
   * of these hides a card every authenticated admin can see today, which is the
   * behaviour change that docblock exists to prevent.
   */
  it("declares the setup card first on the default, full width and two rows, shown by its own rule", () => {
    const card = CORE_DECLARATIONS.find(w => w.id === "core/setup");
    expect(card).toBeDefined();
    // Whether it is there is its `shows`, judged per reader before it loads,
    // never a condition or the frame's dismissal.
    expect(card?.shows).toBeTypeOf("function");
    expect(card).not.toHaveProperty("lifecycle");
    expect(card).not.toHaveProperty("dismissible");
    expect(card?.size).toEqual({
      default: { w: 12, h: 2 },
      min: { w: 12, h: 2 },
      max: { w: 12, h: 4 },
    });
    // First on core's default, across the row at its one row of steps: it addresses a reader
    // who has just arrived.
    expect(CORE_DEFAULT_LAYOUT[0]).toEqual({
      widget: "core/setup",
      w: 12,
      h: 2,
    });
  });

  it("no longer declares the old Get started card, or the cards it replaced", () => {
    const ids = [
      ...CORE_WIDGETS.map(w => w.id),
      ...CORE_DECLARATIONS.map(w => w.id),
    ];
    expect(ids).not.toContain("core/get-started");
    expect(ids).not.toContain("core/seed-demo-content");
    expect(ids).not.toContain("core/onboarding-checklist");
  });

  it("offers the Content card only while there is a collection or a Single to list", () => {
    // One card for both: a reader with Singles and no collections still has
    // something it lists, which `collections:present` alone would hide.
    const content = card("core/content-table");
    expect(content.lifecycle).toBe("conditional");
    expect(content.visibleWhen).toBe("content:present");
  });

  it("offers Create and Upcoming releases each on what it needs", () => {
    const shownWhen = (id: string) => {
      const declared = card(id);
      expect(declared.lifecycle, id).toBe("conditional");
      return declared.visibleWhen;
    };
    expect(shownWhen("core/quick-create")).toBe("create:available");
    expect(shownWhen("core/upcoming-releases")).toBe("releases:present");
    // Its gate stays: the condition is about existence, the gate about access.
    expect(card("core/upcoming-releases").requiredPermission).toBeDefined();
  });

  it("no longer declares the Content tile card, which the Content table replaced", () => {
    // Removed outright, not kept as an alias of the table: no core id, no
    // widget and no place in core's default names it.
    expect(getWidget("core/content")).toBeUndefined();
    expect(CORE_WIDGET_IDS).not.toContain("core/content");
    expect(CORE_DEFAULT_LAYOUT.map(card => card.widget)).not.toContain(
      "core/content"
    );
    // The control: the table is declared, so the absence above is the old id's.
    expect(CORE_WIDGET_IDS).toContain("core/content-table");
  });

  it("offers Continue and Team activity only while there is a collection or a Single to read", () => {
    // With none, nobody's saves or events could reach a row: the reader of no content is not
    // shown two cards that could only say there is nothing.
    for (const id of ["core/continue", "core/team-activity"]) {
      expect([id, card(id).lifecycle, card(id).visibleWhen]).toEqual([
        id,
        "conditional",
        "content:present",
      ]);
    }
  });

  it("no longer declares the Collections and Singles cards Content replaced", () => {
    expect(getWidget("core/collections")).toBeUndefined();
    expect(getWidget("core/singles")).toBeUndefined();
  });

  it("keeps every OTHER core card permanent", () => {
    // The control. A conversion that made the whole list conditional would
    // satisfy the cases above while emptying the dashboard, and nothing in
    // those assertions could tell the difference.
    //
    // Membership rather than a count: a change that made one card transient
    // while making another permanent leaves any total unmoved, and the card
    // that quietly stopped being offered is the one nobody would look for.
    const conditional = published()
      .filter(w => w.lifecycle === "conditional")
      .map(w => w.id);
    expect(conditional).toEqual([
      "core/content-table",
      "core/quick-create",
      "core/continue",
      "core/upcoming-releases",
      "core/team-activity",
    ]);
  });

  it("gates only the team card among those that predate the grid, and the releases card", () => {
    // Core's widgets as published, each gate decided by who may be offered
    // the card at all; System health's super-admin rule is a predicate judged
    // per card, not a gate.
    const gated = published()
      .filter(widget => widget.requiredPermission !== undefined)
      .map(widget => widget.id);

    expect(gated).toEqual(["core/team", "core/upcoming-releases"]);
  });

  it("offers the team card on the gate its source asks", () => {
    // The same constant, not an equal copy: the declaration and the resolver
    // cannot come to name different grants.
    expect(teamWidget.access).toBe(TEAM_GATE);
    // Its data is its `load`'s, so it asks no query of its own.
    expect(card("core/team").query).toBeUndefined();
  });

  // Every card is drawn in the dashboard's one frame, which draws its header
  // and every state, so no core widget may decline it -- by the same rule the
  // registry refuses a plugin's that tries.
  it("declines the grid's frame nowhere", () => {
    for (const widget of published()) {
      expect(chromeFieldProblem(widget), widget.id).toBeUndefined();
    }
  });
});

describe("the list cards' Density", () => {
  // Recent entries' Density, declared, is held to the same choice in
  // `core-declarations.test.ts`.
  it.each(["core/continue", "core/team-activity", "core/upcoming-releases"])(
    "%s offers the shared choice, one option for every density",
    id => {
      // 🔴 Restated by hand, a density added to the list would not reach core's list cards.
      const density = card(id).settings?.find(
        setting => setting.name === "density"
      );
      expect(density).toMatchObject({
        type: "select",
        defaultValue: "default",
        options: [...DENSITY_OPTIONS],
      });
      expect(
        (
          density as { options?: { value: string }[] } | undefined
        )?.options?.map(option => option.value)
      ).toEqual([...LIST_DENSITIES]);
    }
  );
});

describe("the content card", () => {
  it("is the table, drawn by its own component from what its load reads", () => {
    // How many rows its load asks is `core-source-cards.test.ts`'s to show.
    expect(card("core/content-table")).toMatchObject({
      archetype: "custom",
      component: "core#ContentTable",
      serverData: true,
    });
    expect(card("core/content-table").query).toBeUndefined();
  });
});

describe("Continue where you left off", () => {
  it("takes Recently edited's place: no core id, card or default names the old one", () => {
    const ids: readonly string[] = CORE_WIDGET_IDS;
    const defaults = CORE_DEFAULT_LAYOUT.map(entry => entry.widget);
    // The control: the card that replaced it is there, so an absence below is
    // the old id being gone rather than a list that is empty.
    expect(ids).toContain("core/continue");
    expect(defaults).toContain("core/continue");
    expect(ids).not.toContain("core/recently-edited");
    expect(defaults).not.toContain("core/recently-edited");
  });

  it("puts its tab on its header and offers the rows a list draws", () => {
    const settings = card("core/continue").settings ?? [];
    const quick = settings.filter(setting => setting.quick === true);
    expect(quick.map(setting => setting.name)).toEqual(["tab"]);
    expect(quick[0]).toMatchObject({
      type: "select",
      defaultValue: "mine",
      options: [
        { label: "Mine", value: "mine" },
        { label: "Team", value: "team" },
      ],
    });
    expect(settings.find(setting => setting.name === "limit")).toMatchObject({
      type: "number",
      min: 1,
      max: MAX_WIDGET_ROWS,
    });
  });
});

describe("the team activity card", () => {
  it("is drawn by its own component from what its load reads, and offers the rows a list draws", () => {
    // How many rows its load asks, one more than it draws so it can say more
    // exist at every size, is `core-source-cards.test.ts`'s to show.
    expect(card("core/team-activity")).toMatchObject({
      archetype: "custom",
      component: "core#TeamActivity",
      serverData: true,
    });
    expect(
      card("core/team-activity").settings?.find(s => s.name === "limit")
    ).toMatchObject({ type: "number", min: 1, max: MAX_WIDGET_ROWS });
  });
});

describe("the upcoming releases card", () => {
  it("hides while nothing is scheduled, stopped or overdue, its answer then being empty", () => {
    expect(card("core/upcoming-releases").hidesWhenEmpty).toBe(true);
  });
});

describe("the removed Recent activity card", () => {
  it("is no core widget: Team activity replaced it, with no alias", () => {
    const ids: readonly string[] = CORE_WIDGET_IDS;
    expect(ids).not.toContain("core/recent-activity");
    expect(getWidget("core/recent-activity")).toBeUndefined();
    // The control: its replacement is.
    expect(ids).toContain("core/team-activity");
  });
});

describe("the team card's description", () => {
  it("names no figure the card may leave out", () => {
    // A small card draws the people alone, and a reader may be allowed to see only one of the
    // two counts, so a line promising both would describe a card that is not there.
    const team = card("core/team");
    expect(team.description).toBeDefined();
    expect(team.description).not.toMatch(/\b(users|roles)\b/i);
  });
});

describe("the default dashboard", () => {
  // The cards on it, in grid order, each at its size in grid units: [id, w, h]. Twelve columns to
  // a row: the onboarding card; Needs attention beside Upcoming releases; Continue beside
  // Content; New form submissions, the form-builder plugin's, beside Team activity.
  const DEFAULT = [
    ["core/setup", 12, 2],
    ["core/needs-attention", 8, 4],
    ["core/upcoming-releases", 4, 4],
    ["core/continue", 6, 4],
    ["core/content-table", 6, 4],
    ["form-builder/new-submissions", 6, 4],
    ["core/team-activity", 6, 4],
  ] as const;
  const FORM_SUBMISSIONS = "form-builder/new-submissions";

  // Each card's own bounds, in grid units: [id, default, min, max]. What the add panel places a
  // new card at, and what a default entry's size must lie within.
  const BOUNDS = [
    // Needs attention three rows tall, which holds two items and folds the rest.
    ["core/needs-attention", [8, 3], [4, 3], [12, 6]],
    ["core/quick-create", [4, 3], [4, 2], [12, 4]],
    // A list card is four to eight rows tall, its body holding four to ten rows; five rows by
    // default.
    ["core/continue", [6, 5], [4, 4], [12, 8]],
    ["core/team-activity", [6, 5], [4, 4], [12, 8]],
    ["core/content-table", [12, 4], [6, 3], [12, 6]],
    // Up to the full row, so the dashboard may widen it to 12 when it shows alone in its row.
    ["core/upcoming-releases", [4, 4], [4, 4], [12, 8]],
  ] as const;

  const unit = ([w, h]: readonly [number, number]) => ({ w, h });

  it("is core's own defaultLayout: the agreed cards, in the agreed order, at the agreed sizes", () => {
    // Written out in full rather than read from any list of what is registered, so a card
    // added to or dropped from core's widgets cannot move the default with it.
    expect(CORE_DEFAULT_LAYOUT).toEqual([
      { widget: "core/setup", w: 12, h: 2 },
      { widget: "core/needs-attention", w: 8, h: 4 },
      { widget: "core/upcoming-releases", w: 4, h: 4 },
      { widget: "core/continue", w: 6, h: 4 },
      { widget: "core/content-table", w: 6, h: 4 },
      { widget: "form-builder/new-submissions", w: 6, h: 4, optional: true },
      { widget: "core/team-activity", w: 6, h: 4 },
    ]);
    // The table the other cases read agrees with it.
    expect(
      CORE_DEFAULT_LAYOUT.map(({ widget, w, h }) => [widget, w, h])
    ).toEqual(DEFAULT.map(([widget, w, h]) => [widget, w, h]));
  });

  it("names one widget that is not core's, the form submissions card, as optional", () => {
    // A site without the form-builder plugin leaves it out, with no startup fault; every other
    // entry is a core widget, so no other plugin's widget is placed by core's default.
    const core: ReadonlySet<string> = new Set(CORE_WIDGET_IDS);
    const notCore = CORE_DEFAULT_LAYOUT.filter(
      entry => !core.has(entry.widget)
    );
    expect(notCore).toEqual([
      { widget: FORM_SUBMISSIONS, w: 6, h: 4, optional: true },
    ]);
    // The control: every core entry must be installed, so none is optional.
    const coreEntries = CORE_DEFAULT_LAYOUT.filter(entry =>
      core.has(entry.widget)
    );
    expect(coreEntries).toHaveLength(DEFAULT.length - 1);
    expect(coreEntries.filter(entry => entry.optional !== undefined)).toEqual(
      []
    );
  });

  it("places each core card within its widget's bounds, so none is clamped where it is placed", () => {
    const core: ReadonlySet<string> = new Set(CORE_WIDGET_IDS);
    for (const entry of CORE_DEFAULT_LAYOUT.filter(e => core.has(e.widget))) {
      const { min, max } = sizeBounds(sizeOf(entry.widget));
      const size = { w: entry.w ?? 0, h: entry.h ?? 0 };
      expect([entry.widget, size.w >= min.w && size.w <= max.w]).toEqual([
        entry.widget,
        true,
      ]);
      expect([entry.widget, size.h >= min.h && size.h <= max.h]).toEqual([
        entry.widget,
        true,
      ]);
    }
  });

  it("lets Needs attention and Upcoming releases be drawn across the whole row", () => {
    // The admin draws the one of the pair on show across the row while the other is not.
    for (const id of ["core/needs-attention", "core/upcoming-releases"]) {
      expect([id, sizeBounds(sizeOf(id)).max.w]).toEqual([id, 12]);
    }
  });

  it("states no defaultOrder on any of core's widgets: the order is the defaultLayout's", () => {
    for (const widget of published()) {
      expect([widget.id, widget.defaultOrder]).toEqual([widget.id, undefined]);
    }
  });

  it("gives each card its agreed starting size, within its agreed bounds", () => {
    // Read through `sizeBounds`, as every reader of a size reads it, so an end
    // left to its default is checked as the grid will draw it.
    for (const [id, dflt, min, max] of BOUNDS) {
      expect([id, sizeBounds(sizeOf(id))]).toEqual([
        id,
        { default: unit(dflt), min: unit(min), max: unit(max) },
      ]);
    }
  });

  /** The heights of each row, laid out as the grid lays the cards: in order, twelve to a row. */
  const rowHeights = (cards: ReadonlyArray<{ w?: number; h?: number }>) => {
    const rows: number[][] = [[]];
    let used = 0;
    for (const { w = 0, h = 0 } of cards) {
      if (used + w > 12) {
        rows.push([]);
        used = 0;
      }
      rows[rows.length - 1].push(h);
      used += w;
    }
    return rows;
  };

  it("tiles: the cards that share a row share a height, with the form submissions card or without it", () => {
    // 🔴 A card beside a taller one leaves a gap below it; no later card is moved up to fill it.
    const withForms = rowHeights(CORE_DEFAULT_LAYOUT);
    // The control: the rows are the agreed four, so a single-row answer cannot pass.
    expect(withForms).toEqual([[2], [4, 4], [4, 4], [4, 4]]);
    const withoutForms = rowHeights(
      CORE_DEFAULT_LAYOUT.filter(entry => entry.widget !== FORM_SUBMISSIONS)
    );
    for (const heights of [...withForms, ...withoutForms]) {
      expect(new Set(heights).size).toBe(1);
    }
  });

  it("is all core registers: the default's cards, the add-only cards, and Create", () => {
    // Nothing else is core's, so no news feed, upsell, quick draft, clock, profile or banner
    // card exists to be offered. Create is the one card past those two sets.
    const expected = [
      // On the default.
      "core/setup",
      "core/needs-attention",
      "core/upcoming-releases",
      "core/continue",
      "core/content-table",
      "core/team-activity",
      // Offered from the add panel only; System health to super-admins alone.
      "core/count",
      "core/recent-entries",
      "core/over-time",
      "core/breakdown",
      "core/note",
      "core/team",
      "core/system-health",
      // Create.
      "core/quick-create",
    ].sort();
    expect([...CORE_WIDGET_IDS].sort()).toEqual(expected);
    // The ids the registry is handed: the definitions and the declarations together.
    expect(
      [
        ...CORE_WIDGETS.map(widget => widget.id),
        ...CORE_DECLARATIONS.map(widget => widget.id),
      ].sort()
    ).toEqual(expected);
  });
});
