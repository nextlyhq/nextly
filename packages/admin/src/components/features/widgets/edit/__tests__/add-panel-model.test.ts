/**
 * What the add panel lists: its rows, what each one's button does, and what a search keeps.
 */
import { describe, expect, it } from "vitest";

import type {
  DashboardWidget,
  WidgetPlacement,
  WidgetWidthFacts,
} from "@admin/types/dashboard/widgets";

import {
  addPanelCount,
  addPanelGroups,
  addPanelRows,
  REMOVED_ROW_DESCRIPTION,
  searchAddPanel,
} from "../add-panel-model";

const ALL = ["quarter", "third", "half", "twoThirds", "full"] as const;

function facts(over: Partial<WidgetWidthFacts>): WidgetWidthFacts {
  return {
    allowedWidths: [...ALL],
    defaultWidth: "full",
    allowsSeveral: false,
    group: "overview",
    sketch: "metric",
    rank: 0,
    ...over,
  } as WidgetWidthFacts;
}

const declared = (id: string, title: string): DashboardWidget =>
  ({ id, title, archetype: "metric" }) as unknown as DashboardWidget;

const placement = (
  id: string,
  widgetId: string,
  removed = false
): WidgetPlacement => ({ id, widgetId, width: "full", removed });

const byId = new Map(
  [
    declared("core/collections", "Collections"),
    declared("core/team", "Team"),
    declared("site/notes", "Notes"),
    declared("forms/latest", "Latest submissions"),
  ].map(widget => [widget.id, widget])
);

const WIDGETS = {
  "core/collections": facts({
    rank: 0,
    description: "Entry counts per collection.",
  }),
  "site/notes": facts({
    rank: 1,
    allowsSeveral: true,
    sketch: "text",
    allowedWidths: ["half", "full"],
  }),
  "core/team": facts({ rank: 2, group: "team" }),
  "forms/latest": facts({
    rank: 3,
    group: "plugins",
    subgroup: "@acme/forms",
    category: "Forms",
    description: "The newest submissions.",
  }),
};

describe("the add panel's rows", () => {
  it("lists the reader's removed cards first, each to be put back as it was", () => {
    const rows = addPanelRows({
      placements: [placement("p1", "core/team", true)],
      offered: [],
      widgets: WIDGETS,
      byId,
    });
    expect(rows[0]).toMatchObject({
      key: "removed:p1",
      section: "removed",
      name: "Team",
      description: REMOVED_ROW_DESCRIPTION,
      action: { kind: "add-back", placementId: "p1" },
    });
  });

  it("shows a one-card widget that is placed as on the dashboard, never as Add", () => {
    // 🔴 The plausible slip: offering Add because the widget exists, for a card the server
    // refuses as a duplicate.
    const rows = addPanelRows({
      placements: [placement("p1", "core/collections")],
      offered: ["core/collections"],
      widgets: WIDGETS,
      byId,
    });
    expect(rows.find(row => row.key === "core/collections")?.action).toEqual({
      kind: "on-dashboard",
    });
  });

  it("lists a removed one-card widget once, under Removed, never as a fresh card", () => {
    // 🔴 Offered too, as a server that counts only drawn cards would: the slip is a second row
    // for the same card, or an Add the server refuses as a duplicate.
    const rows = addPanelRows({
      placements: [placement("p9", "core/team", true)],
      offered: ["core/team"],
      widgets: WIDGETS,
      byId,
    });
    expect(rows.filter(row => row.name === "Team")).toEqual([
      expect.objectContaining({
        key: "removed:p9",
        section: "removed",
        action: { kind: "add-back", placementId: "p9" },
      }),
    ]);
  });

  it("offers another card of a widget that allows several, and counts those placed", () => {
    const rows = addPanelRows({
      placements: [placement("a", "site/notes"), placement("b", "site/notes")],
      offered: ["site/notes"],
      widgets: WIDGETS,
      byId,
    });
    expect(rows.find(row => row.key === "site/notes")).toMatchObject({
      placed: 2,
      action: { kind: "add-another", widgetId: "site/notes" },
      widths: "½ to Full wide",
    });
  });

  it("lists a widget the server does not offer and the reader never placed nowhere", () => {
    const rows = addPanelRows({
      placements: [],
      offered: ["core/collections"],
      widgets: WIDGETS,
      byId,
    });
    expect(rows.map(row => row.key)).toEqual(["core/collections"]);
  });

  it("orders rows by core's rank, a placed one included", () => {
    // 🔴 The server's `available` leaves a placed one-card widget out; ordered by it, the
    // on-dashboard row would fall to the end or vanish.
    const rows = addPanelRows({
      placements: [placement("p", "core/collections")],
      offered: ["site/notes", "core/team", "forms/latest"],
      widgets: WIDGETS,
      byId,
    });
    expect(rows.map(row => row.key)).toEqual([
      "core/collections",
      "site/notes",
      "core/team",
      "forms/latest",
    ]);
  });

  it("leaves out a widget this admin cannot draw, and the Content group", () => {
    const rows = addPanelRows({
      placements: [],
      offered: ["ghost/widget", "content/posts"],
      widgets: {
        "ghost/widget": facts({ rank: 0 }),
        "content/posts": facts({
          rank: 1,
          group: "content",
          subgroup: "posts",
        }),
      },
      byId: new Map([["content/posts", declared("content/posts", "Posts")]]),
    });
    expect(rows).toEqual([]);
  });
});

describe("searching the add panel", () => {
  const rows = addPanelRows({
    placements: [],
    offered: Object.keys(WIDGETS),
    widgets: WIDGETS,
    byId,
  });

  it.each([
    ["the name", "notes", ["site/notes"]],
    ["the description, ignoring case", "ENTRY COUNTS", ["core/collections"]],
    ["the category", "forms", ["forms/latest"]],
    ["the group's heading", "team", ["core/team"]],
    ["the sub-group", "@acme", ["forms/latest"]],
  ])("finds a widget by %s", (_how, query, expected) => {
    expect(searchAddPanel(rows, query).map(row => row.key)).toEqual(expected);
  });

  describe("a removed one-card plugin widget, listed only under Removed", () => {
    const removedRows = addPanelRows({
      placements: [placement("p4", "forms/latest", true)],
      offered: ["forms/latest"],
      widgets: WIDGETS,
      byId,
    });

    // 🔴 Its Removed row is the only way back, so a search by what the widget's own row would
    // have been found by must still find it. The plausible slip searches the put-back line alone.
    it.each([
      ["its description", "newest submissions"],
      ["its category", "forms"],
      ["its group's heading", "plugins"],
      ["its plugin", "@acme"],
    ])("is found by %s", (_how, query) => {
      expect(searchAddPanel(removedRows, query).map(row => row.key)).toEqual([
        "removed:p4",
      ]);
    });

    it("still says how it comes back, and stays out of any sub-group", () => {
      const [row] = removedRows;
      expect(row).toMatchObject({
        section: "removed",
        description: REMOVED_ROW_DESCRIPTION,
      });
      expect(row.subgroup).toBeUndefined();
      expect(addPanelGroups(removedRows)[0].subgroups).toEqual([]);
    });

    it("is not found by text the widget does not carry", () => {
      expect(searchAddPanel(removedRows, "invoices")).toEqual([]);
    });
  });

  it("keeps every row for an empty or blank query", () => {
    expect(searchAddPanel(rows, "   ")).toHaveLength(rows.length);
  });

  it("says how many it found, and for what", () => {
    expect(addPanelCount(4, "")).toBe("4 widgets");
    expect(addPanelCount(1, " team ")).toBe("1 result for “team”");
    expect(addPanelCount(0, "zzz")).toBe("0 results for “zzz”");
  });
});

describe("the add panel's groups", () => {
  it("draws the groups in order, with a plugin's widgets under its sub-group", () => {
    const groups = addPanelGroups(
      addPanelRows({
        // A placed team card fills Team; a removed one-card widget is listed under Removed only.
        placements: [
          placement("r", "core/collections", true),
          placement("t", "core/team"),
        ],
        offered: ["site/notes", "forms/latest"],
        widgets: WIDGETS,
        byId,
      })
    );
    expect(groups.map(group => group.section.id)).toEqual([
      "removed",
      "overview",
      "team",
      "plugins",
    ]);
    const plugins = groups.find(group => group.section.id === "plugins");
    expect(plugins?.rows).toEqual([]);
    expect(plugins?.subgroups.map(sub => [sub.name, sub.rows.length])).toEqual([
      ["@acme/forms", 1],
    ]);
  });
});

describe("a widget offered per collection", () => {
  const count = {
    id: "core/count",
    title: "Count",
    archetype: "metric",
    settings: [{ name: "collection", type: "collection" }],
  } as unknown as DashboardWidget;
  const rowsFor = (placements: WidgetPlacement[]) =>
    addPanelRows({
      placements,
      offered: ["core/count"],
      widgets: {
        "core/count": facts({
          group: "content",
          perCollection: true,
          allowsSeveral: true,
        }),
      },
      byId: new Map([["core/count", count]]),
      collections: [
        { collection: "posts", label: "Posts" },
        { collection: "pages", label: "Pages" },
      ],
      showContent: true,
    });

  it("is one row per collection the reader may read, each adding a card set to it", () => {
    const rows = rowsFor([]);
    expect(rows.map(row => [row.key, row.subgroup, row.action])).toEqual([
      [
        "core/count:posts",
        "Posts",
        {
          kind: "add",
          widgetId: "core/count",
          settings: { collection: "posts" },
        },
      ],
      [
        "core/count:pages",
        "Pages",
        {
          kind: "add",
          widgetId: "core/count",
          settings: { collection: "pages" },
        },
      ],
    ]);
  });

  it("counts only that collection's cards, offering another beside them", () => {
    const rows = rowsFor([
      { ...placement("a", "core/count"), config: { collection: "posts" } },
    ]);
    expect(rows.map(row => [row.key, row.placed, row.action.kind])).toEqual([
      ["core/count:posts", 1, "add-another"],
      ["core/count:pages", 0, "add"],
    ]);
  });

  it("stays out of the panel while the Content group is not shown", () => {
    expect(
      addPanelRows({
        placements: [],
        offered: ["core/count"],
        widgets: {
          "core/count": facts({ group: "content", perCollection: true }),
        },
        byId: new Map([["core/count", count]]),
        collections: [{ collection: "posts", label: "Posts" }],
        showContent: false,
      })
    ).toEqual([]);
  });
});
