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
import { beforeAll, describe, expect, it } from "vitest";

import { registerContinueWidgetSource } from "../../../services/dashboard/continue-widget-source";
import { parsePermissionSlug } from "../../../plugins/routes/permission-slug";
import { publishedWidgetDefinition } from "../../../plugins/test-widget-card";
import { RELEASES_RESOURCE } from "../../releases/services/releases-service";
import { CORE_DECLARATIONS, CORE_WIDGETS } from "../core-widgets";
import { CORE_DEFAULT_LAYOUT, CORE_WIDGET_IDS } from "../core-widgets/ids";
import {
  chromeFieldProblem,
  requiredPermissionSlugs,
  validateWidgetDefinition,
} from "../definition";
import { sizeBounds, sizeDeclarationProblems } from "../grid-size";
import { DENSITY_OPTIONS } from "../declaration/setting-builders";
import { LIST_DENSITIES, MAX_WIDGET_ROWS } from "../query-limits";
import { resolveWidgetSettings } from "../settings";
import { clearSources } from "../sources";
import { CONTENT_SOURCE_ID, TEAM_SOURCE_ID } from "../system-source-ids";
import { clearSystemResolvers } from "../system-sources";
import { TEAM_GATE } from "../team-gate";

function card(id: string) {
  const found = CORE_WIDGETS.find(widget => widget.id === id);
  // Resolved through a lookup that REFUSES rather than through `!`, so a
  // renamed or removed card fails here naming itself, instead of every
  // assertion below reading `undefined` and reporting something unrelated.
  if (!found) throw new Error(`no core widget with id "${id}"`);
  return found;
}

/** A core widget's declared size, whether it is a definition or a declaration. */
function sizeOf(id: string) {
  const declared = CORE_DECLARATIONS.find(widget => widget.id === id);
  return declared === undefined ? card(id).size : declared.size;
}

// As boot orders it: a card's settings are admitted against the filters its
// source declares, so the sources a card names are registered first.
beforeAll(() => {
  clearSources();
  clearSystemResolvers();
  registerContinueWidgetSource();
});

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

  it.each(CORE_WIDGETS.map(widget => [widget.id, widget] as const))(
    "%s is never sized below two rows",
    (_id, widget) => {
      // One row cannot hold the frame's padding, header and gap, so a card
      // declared at one row draws a header with no body under it.
      expect(sizeDeclarationProblems(widget.size)).toEqual([]);
      const { min } = sizeBounds(widget.size);
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
    // First on core's default: it addresses a reader who has just arrived.
    expect(CORE_DEFAULT_LAYOUT[0]).toEqual({ widget: "core/setup" });
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
    const content = CORE_WIDGETS.find(w => w.id === "core/content-table");
    expect(content?.lifecycle).toBe("conditional");
    expect(content?.visibleWhen).toBe("content:present");
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
    // definition and no place in core's default names it.
    expect(CORE_WIDGETS.map(w => w.id)).not.toContain("core/content");
    expect(CORE_WIDGET_IDS).not.toContain("core/content");
    expect(CORE_DEFAULT_LAYOUT.map(card => card.widget)).not.toContain(
      "core/content"
    );
    // The control: the table is declared, so the absence above is the old id's.
    expect(CORE_WIDGET_IDS).toContain("core/content-table");
  });

  it("no longer declares the Collections and Singles cards Content replaced", () => {
    const ids = CORE_WIDGETS.map(w => w.id);
    expect(ids).not.toContain("core/collections");
    expect(ids).not.toContain("core/singles");
  });

  it("keeps every OTHER core card permanent", () => {
    // The control. A conversion that made the whole list conditional would
    // satisfy the cases above while emptying the dashboard, and nothing in
    // those assertions could tell the difference.
    //
    // Membership rather than a count: a change that made one card transient
    // while making another permanent leaves any total unmoved, and the card
    // that quietly stopped being offered is the one nobody would look for.
    const conditional = CORE_WIDGETS.filter(
      w => w.lifecycle === "conditional"
    ).map(w => w.id);
    expect(conditional).toEqual([
      "core/content-table",
      "core/quick-create",
      "core/upcoming-releases",
    ]);
  });

  it("gates only the team card among those that predate the grid, and the releases card", () => {
    const gated = CORE_WIDGETS.filter(
      widget => widget.requiredPermission !== undefined
    ).map(widget => widget.id);

    expect(gated).toEqual(["core/team", "core/upcoming-releases"]);
  });

  it("offers the team card on the gate its source asks", () => {
    // The same constant, not an equal copy: the declaration and the resolver
    // cannot come to name different grants.
    const team = card("core/team");
    expect(team.requiredPermission).toBe(TEAM_GATE);
    expect(team.query).toEqual({ source: TEAM_SOURCE_ID, op: "list" });
  });

  // Every card is drawn in the dashboard's one frame, which draws its header
  // and every state, so no core widget may decline it -- by the same rule the
  // registry refuses a plugin's that tries.
  it("declines the grid's frame nowhere", () => {
    for (const widget of CORE_WIDGETS) {
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
      const widget = CORE_WIDGETS.find(w => w.id === id);
      const density = widget?.settings?.find(
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

describe("a new card's defaults, before its reader touches a setting", () => {
  /** A declared core card as the registry publishes it to the admin. */
  function published(id: string) {
    const declared = CORE_DECLARATIONS.find(widget => widget.id === id);
    if (!declared) throw new Error(`no core declaration with id "${id}"`);
    return publishedWidgetDefinition(declared, "core");
  }

  it("reads Over time's range as the last 30 days, through the reader its card is asked with", () => {
    // Through `resolveWidgetSettings`, what the card's load and the admin read, rather than the
    // literal: a default the reader set aside (one its options no longer hold) reads otherwise.
    expect(
      resolveWidgetSettings(published("core/over-time").settings, {}).dateRange
    ).toBe("30d");
  });

  it("draws Over time's range with the card's data, and its chart style with how it shows", () => {
    const sections = Object.fromEntries(
      (published("core/over-time").settings ?? []).map(setting => [
        setting.name,
        setting.section,
      ])
    );
    // The range is a select the panel cannot tell from any other: it says where it goes.
    expect(sections.dateRange).toBe("data");
    // The rest state nothing, and the panel places them by kind.
    expect(sections.chartStyle).toBeUndefined();
  });

  it.each([
    ["core/recent-entries", true],
    ["core/continue", false],
    ["core/team-activity", false],
    ["core/upcoming-releases", false],
  ])("folds %s's Density under Advanced", (id, declared) => {
    const settings = declared
      ? published(id).settings
      : CORE_WIDGETS.find(widget => widget.id === id)?.settings;
    expect(settings?.find(setting => setting.name === "density")?.section).toBe(
      "advanced"
    );
  });

  it("draws Continue's Tab with the card's data, since it narrows whose work the card reads", () => {
    expect(
      CORE_WIDGETS.find(
        widget => widget.id === "core/continue"
      )?.settings?.find(setting => setting.name === "tab")?.section
    ).toBe("data");
  });
});

describe("the content card", () => {
  it("is the table, asked for the rows its size draws, never every collection", () => {
    // 🔴 Asked at the most a query may return, the card's source counted fifty
    // collections on every load. Sized, it is asked the rows the card draws and
    // one more, and its source counts only those.
    expect(card("core/content-table")).toMatchObject({
      component: "core#ContentTable",
      sizedQuery: true,
      query: {
        source: CONTENT_SOURCE_ID,
        op: "list",
        limit: MAX_WIDGET_ROWS,
      },
    });
  });
});

describe("Continue where you left off", () => {
  it("takes Recently edited's place: no core id, card or default names the old one", () => {
    const ids = CORE_WIDGETS.map(widget => widget.id);
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
  it("is asked like core's own lists, so it can say more exist at every size", () => {
    // Its component draws the rows its size allows and says more exist from
    // the one row more; asked exactly its "Number of items", that row never
    // comes at medium or large and the card can never say it.
    const card = CORE_WIDGETS.find(
      widget => widget.id === "core/team-activity"
    );
    expect(card).toMatchObject({
      archetype: "custom",
      sizedQuery: true,
      query: { op: "list" },
    });
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
    expect(CORE_WIDGETS.map(widget => widget.id)).not.toContain(
      "core/recent-activity"
    );
    // The control: its replacement is.
    expect(ids).toContain("core/team-activity");
  });
});

describe("the team card's description", () => {
  it("names no figure the card may leave out", () => {
    // A small card draws the people alone, and a reader may be allowed to see only one of the
    // two counts, so a line promising both would describe a card that is not there.
    const team = CORE_WIDGETS.find(widget => widget.id === "core/team");
    expect(team?.description).toBeDefined();
    expect(team?.description).not.toMatch(/\b(users|roles)\b/i);
  });
});

describe("the default dashboard", () => {
  // The agreed cards, in order, each at its agreed size and within its agreed
  // bounds, in grid units: [id, default, min, max].
  const AGREED = [
    // Needs attention three rows tall, which holds two items and folds the rest; Create as
    // tall, beside it.
    ["core/needs-attention", [8, 3], [4, 3], [12, 6]],
    ["core/quick-create", [4, 3], [4, 2], [12, 4]],
    // A list card is four to eight rows tall, its body holding four to ten rows; five rows by
    // default.
    ["core/continue", [6, 5], [4, 4], [12, 8]],
    ["core/team-activity", [6, 5], [4, 4], [12, 8]],
    ["core/content-table", [12, 4], [6, 3], [12, 6]],
    // Alone on its row: Team, for the people who manage the team, is not on the default.
    // Up to the full row, so the dashboard may widen it to 12 when it shows alone in its row.
    ["core/upcoming-releases", [4, 4], [4, 4], [12, 8]],
  ] as const;

  const unit = ([w, h]: readonly [number, number]) => ({ w, h });

  it("is core's own defaultLayout: the setup card, then the agreed cards as agreed", () => {
    // Each at its widget's starting size: no entry states a size or settings of its own.
    expect(CORE_DEFAULT_LAYOUT).toEqual([
      { widget: "core/setup" },
      ...AGREED.map(([id]) => ({ widget: id })),
    ]);
  });

  it("states no defaultOrder on any of core's widgets: the order is the defaultLayout's", () => {
    for (const widget of CORE_WIDGETS) {
      expect([widget.id, widget.defaultOrder]).toEqual([widget.id, undefined]);
    }
  });

  it("gives each its agreed size, within its agreed bounds", () => {
    // Read through `sizeBounds`, as every reader of a size reads it, so an end
    // left to its default is checked as the grid will draw it.
    for (const [id, dflt, min, max] of AGREED) {
      expect([id, sizeBounds(sizeOf(id))]).toEqual([
        id,
        { default: unit(dflt), min: unit(min), max: unit(max) },
      ]);
    }
  });

  it("tiles: the cards that share a row of the default dashboard share a height", () => {
    // 🔴 Laid out as the grid lays them, in order and twelve columns to a row,
    // a card beside a taller one leaves a gap below it. The agreed sizes are
    // chosen so no row of the default dashboard has one.
    const rows: number[][] = [[]];
    let used = 0;
    for (const [id] of AGREED) {
      const { w, h } = sizeOf(id).default;
      if (used + w > 12) {
        rows.push([]);
        used = 0;
      }
      rows[rows.length - 1].push(h);
      used += w;
    }
    for (const heights of rows) {
      expect(new Set(heights).size).toBe(1);
    }
  });
});
