/**
 * A placed widget as its batch asks it: the reader's Collection and Only mine
 * reach the query's `where` on a source that narrows by them, as the widget's
 * `sourceFilters` say, and replace the source on a collection source.
 */
import { describe, expect, it } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { widgetAsAsked } from "../widget-as-asked";

const settings: DashboardWidget["settings"] = [
  {
    name: "onlyMine",
    label: "Only mine",
    type: "checkbox",
    defaultValue: false,
  },
  { name: "collection", label: "Collection", type: "collection" },
];

const recentlyEdited: DashboardWidget = {
  id: "core/recently-edited",
  title: "Recently edited",
  archetype: "list",
  size: "md",
  query: { source: "system:recent-edits", op: "list", limit: 5 },
  settings,
  sourceFilters: ["collection", "onlyMine"],
};

describe("a widget as it is asked", () => {
  it("narrows a filtering source by the reader's Collection and Only mine", () => {
    const asked = widgetAsAsked(recentlyEdited, {
      collection: "pages",
      onlyMine: true,
    });
    expect(asked.query?.source).toBe("system:recent-edits");
    expect(asked.query?.where).toEqual({ collection: "pages", onlyMine: true });
  });

  it("asks a source without declared filters by its collection instead", () => {
    // 🔴 The must-differ case: the same settings without `sourceFilters` take
    // the collection knob's other branch, so the card's source is replaced.
    const { sourceFilters: _filters, ...unfiltered } = recentlyEdited;
    const asked = widgetAsAsked(
      {
        ...unfiltered,
        query: { source: "collection:posts", op: "list", limit: 5 },
      },
      { collection: "pages", onlyMine: true }
    );
    expect(asked.query?.source).toBe("collection:pages");
    expect(asked.query?.where).toBeUndefined();
  });

  it("keeps the widget itself when nothing is chosen", () => {
    expect(widgetAsAsked(recentlyEdited, {}).query?.where).toBeUndefined();
  });
});
