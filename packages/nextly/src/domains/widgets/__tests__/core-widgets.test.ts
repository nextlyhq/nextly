/**
 * The core cards' declarations, held against the modules that have to honour
 * them.
 *
 * Deliberately NOT a restatement of the list. Asserting that a card carries the
 * literal written three lines away in `core-widgets.ts` is a test that can only
 * ever agree with itself, and it would go on agreeing while the thing the
 * literal REFERS to was renamed underneath it. What is checked here is each
 * declaration against the module that consumes it.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { registerRecentEditsWidgetSource } from "../../../services/dashboard/recent-edits-widget-source";
import { parsePermissionSlug } from "../../../plugins/routes/permission-slug";
import { RELEASES_RESOURCE } from "../../releases/services/releases-service";
import { CORE_WIDGETS } from "../core-widgets";
import {
  chromeFieldProblem,
  requiredPermissionSlugs,
  validateWidgetDefinition,
} from "../definition";
import { sizeBounds, sizeDeclarationProblems } from "../grid-size";
import { MAX_WIDGET_LIMIT } from "../query-limits";
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

// As boot orders it: a card's settings are admitted against the filters its
// source declares, so the sources a card names are registered first.
beforeAll(() => {
  clearSources();
  clearSystemResolvers();
  registerRecentEditsWidgetSource();
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
  it("declares Get started visible by permission alone: first, full width, dismissible", () => {
    // 🔴 No condition. Visibility is part of the token a layout write is
    // checked against, so a card whose visibility followed its steps would
    // turn a skip or a dismissal into a stale-scope refusal whenever a step
    // changed between the read and the write. The layout read draws it or
    // leaves it dormant instead.
    const card = CORE_WIDGETS.find(w => w.id === "core/get-started");
    expect(card).toBeDefined();
    expect(card?.lifecycle ?? "always").toBe("always");
    expect(card).not.toHaveProperty("visibleWhen");
    expect(card?.dismissible).toBe(true);
    // Full width only, and compact: its steps fold to the rows it has, so it may be as short
    // as three rows without a step cut off.
    expect(card && sizeBounds(card.size)).toEqual({
      default: { w: 12, h: 4 },
      min: { w: 12, h: 3 },
      max: { w: 12, h: 12 },
    });
    const orders = CORE_WIDGETS.map(w => w.defaultOrder ?? Infinity);
    expect(card?.defaultOrder).toBe(Math.min(...orders));
  });

  it("no longer declares the two cards Get started replaced", () => {
    const ids = CORE_WIDGETS.map(w => w.id);
    expect(ids).not.toContain("core/seed-demo-content");
    expect(ids).not.toContain("core/onboarding-checklist");
  });

  it("offers the Content card only while there is a collection or a Single to list", () => {
    // One card for both: a reader with Singles and no collections still has
    // something it lists, which `collections:present` alone would hide.
    const content = CORE_WIDGETS.find(w => w.id === "core/content");
    expect(content?.lifecycle).toBe("conditional");
    expect(content?.visibleWhen).toBe("content:present");
  });

  it("offers Create, Needs attention and Upcoming releases each on what it needs", () => {
    const shownWhen = (id: string) => {
      const declared = card(id);
      expect(declared.lifecycle, id).toBe("conditional");
      return declared.visibleWhen;
    };
    expect(shownWhen("core/quick-create")).toBe("create:available");
    expect(shownWhen("core/needs-attention")).toBe("attention:readable");
    expect(shownWhen("core/upcoming-releases")).toBe("releases:present");
    // Its gate stays: the condition is about existence, the gate about access.
    expect(card("core/upcoming-releases").requiredPermission).toBeDefined();
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
      "core/content",
      "core/quick-create",
      "core/needs-attention",
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

describe("the content card", () => {
  it("asks for every collection, not the default five", () => {
    // An omitted limit is materialized as the default 5, which would cut a
    // site's sixth collection from the card.
    expect(card("core/content").query).toEqual({
      source: CONTENT_SOURCE_ID,
      op: "list",
      limit: MAX_WIDGET_LIMIT,
    });
  });
});

describe("the recent activity card", () => {
  it("is asked like core's own lists, so it can say more exist at every size", () => {
    // Its component draws the rows its size allows and says more exist from
    // the one row more; asked exactly its "Number of items", that row never
    // comes at medium or large and the card can never say it.
    const card = CORE_WIDGETS.find(
      widget => widget.id === "core/recent-activity"
    );
    expect(card).toMatchObject({
      archetype: "custom",
      sizedQuery: true,
      query: { op: "list" },
    });
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
    ["core/needs-attention", [8, 3], [4, 3], [12, 6]],
    ["core/quick-create", [4, 3], [4, 2], [12, 4]],
    ["core/recently-edited", [6, 4], [4, 3], [12, 6]],
    ["core/recent-activity", [6, 4], [4, 3], [12, 6]],
    ["core/content", [12, 4], [6, 3], [12, 6]],
    ["core/upcoming-releases", [4, 4], [4, 3], [8, 6]],
    ["core/team", [4, 4], [3, 2], [6, 4]],
  ] as const;

  const unit = ([w, h]: readonly [number, number]) => ({ w, h });

  it("orders the agreed cards as agreed", () => {
    const ordered = CORE_WIDGETS.filter(w => AGREED.some(([id]) => id === w.id))
      .slice()
      .sort((a, b) => (a.defaultOrder ?? 0) - (b.defaultOrder ?? 0))
      .map(w => w.id);
    expect(ordered).toEqual(AGREED.map(([id]) => id));
  });

  it("gives each its agreed size, within its agreed bounds", () => {
    // Read through `sizeBounds`, as every reader of a size reads it, so an end
    // left to its default is checked as the grid will draw it.
    for (const [id, dflt, min, max] of AGREED) {
      expect([id, sizeBounds(card(id).size)]).toEqual([
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
      const { w, h } = card(id).size.default;
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
