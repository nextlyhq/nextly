/**
 * Which group of the add panel each widget is listed in, and in what order.
 *
 * Core assigns the group; a widget never declares it. A built-in names its
 * own, a plugin's widget is under Plugins by its plugin, a card core derives
 * from a collection is under Content by that collection, and any other widget
 * the site has is its own and goes under Overview, after the built-ins, in the
 * order it was declared. A declared category is a label to search, never a
 * group.
 */
import { describe, expect, it } from "vitest";

import { addPanelFacts, inAddPanelOrder } from "../add-panel";
import type { CanonicalWidget } from "../canonical";
import { CORE_WIDGET_IDS } from "../core-widgets";

const core = (id: string): CanonicalWidget => ({ id });

describe("the group each widget is listed in", () => {
  it("puts the team's two built-ins under Team, the content widgets under Content, and every other built-in under Overview", () => {
    // Every one of core's, its declarations included: the group is read by id.
    const groups = Object.fromEntries(
      CORE_WIDGET_IDS.map(id => [id, addPanelFacts(core(id))?.group])
    );
    expect(groups).toEqual({
      "core/get-started": "overview",
      "core/content": "overview",
      "core/quick-create": "overview",
      "core/team": "team",
      "core/needs-attention": "overview",
      "core/recently-edited": "overview",
      "core/upcoming-releases": "overview",
      "core/recent-activity": "team",
      // Offered per collection, inside each collection's part of Content.
      "core/count": "content",
      "core/breakdown": "content",
      // Offered on request: one row of Overview.
      "core/note": "overview",
      // Offered per collection, as Count is.
      "core/recent-entries": "content",
      "core/over-time": "content",
    });
  });

  it("puts a plugin's widget under Plugins, by its plugin, whatever it declares as its category", () => {
    // 🔴 The separating case: a category naming a core group must not move it.
    const facts = addPanelFacts({
      id: "forms/latest",
      plugin: "@acme/forms",
      category: "Team",
    });
    expect(facts?.group).toBe("plugins");
    expect(facts?.subgroup).toBe("@acme/forms");
    expect(facts?.category).toBe("Team");
  });

  it("offers no card core derived from a collection: those are retired", () => {
    // 🔴 Not Content: that group is the catalogue's, and a derived card
    // listed there would appear in it the day it is turned on.
    expect(
      addPanelFacts({
        id: "collection:posts/recent",
        generated: true,
        collection: "posts",
      })
    ).toBeUndefined();
  });

  it("puts any other widget the site has under Overview", () => {
    const facts = addPanelFacts({ id: "site/sales-target", category: "Shop" });
    expect(facts?.group).toBe("overview");
    expect(facts?.subgroup).toBeUndefined();
    expect(facts?.category).toBe("Shop");
  });

  it("names nothing a widget did not declare", () => {
    // Absent rather than empty: the panel draws no line for a description
    // nobody wrote.
    const facts = addPanelFacts(core("core/team"));
    expect(facts).not.toHaveProperty("description");
    expect(facts).not.toHaveProperty("category");
    expect(facts).not.toHaveProperty("subgroup");
  });

  it("carries the description and the sketch kind", () => {
    expect(
      addPanelFacts({
        id: "core/recently-edited",
        description: "The documents most recently left with unpublished edits.",
        archetype: "list",
      })
    ).toEqual({
      group: "overview",
      description: "The documents most recently left with unpublished edits.",
      sketch: "list",
    });
    // A widget that names no kind is drawn as a component's sketch.
    expect(addPanelFacts(core("site/x"))?.sketch).toBe("custom");
  });

  it("draws a widget's own sketch where it names one in place of its archetype's", () => {
    // A declared widget drawn by its own component says what it most looks like.
    expect(
      addPanelFacts({ id: "acme/orders", archetype: "custom", sketch: "bars" })
        ?.sketch
    ).toBe("bars");
  });
});

describe("the order the panel lists widgets in", () => {
  it("lists the groups in order, the built-ins first in Overview, then the site's own as declared", () => {
    const listed = inAddPanelOrder([
      { id: "forms/latest", plugin: "@acme/forms" },
      // Two of the site's own, declared in an order that is not alphabetical.
      core("site/zeta"),
      { id: "collection:posts/recent", generated: true, collection: "posts" },
      core("core/team"),
      core("site/alpha"),
      core("core/recently-edited"),
      core("core/quick-create"),
      { id: "seo/issues", plugin: "@acme/seo" },
      { id: "forms/totals", plugin: "@acme/forms" },
    ]).map(widget => widget.id);

    expect(listed).toEqual([
      // Overview: built-ins in core's own order, whatever order they came in.
      "core/quick-create",
      "core/recently-edited",
      // Then the site's own, in the order they were declared.
      "site/zeta",
      "site/alpha",
      // No derived collection card: not offered.
      // Team.
      "core/team",
      // Plugins: each plugin's widgets together, plugins in the order they came.
      "forms/latest",
      "forms/totals",
      "seo/issues",
    ]);
  });

  it("keeps each plugin's widgets together, in the order it declared them", () => {
    const listed = inAddPanelOrder([
      { id: "seo/b", plugin: "@acme/seo" },
      { id: "forms/a", plugin: "@acme/forms" },
      { id: "seo/a", plugin: "@acme/seo" },
    ]).map(widget => widget.id);
    expect(listed).toEqual(["seo/b", "seo/a", "forms/a"]);
  });
});
