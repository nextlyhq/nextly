/**
 * A placed widget as its batch asks it: the reader's Collection and Only mine
 * reach the query's `where` on a source that narrows by them, as the widget's
 * `sourceFilters` say, and replace the source on a collection source.
 */
import type { PublishedContentSource } from "nextly/config";
import { describe, expect, it } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import {
  settingsAsAsked,
  titleAsAsked,
  widgetAsAsked,
} from "../widget-as-asked";

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

describe("a custom card asking through cells", () => {
  const posts: PublishedContentSource = {
    collection: "posts",
    label: "Posts",
    lifecycle: true,
    fields: [{ name: "title", label: "Title", type: "string" }],
  };
  const pages: PublishedContentSource = {
    ...posts,
    collection: "pages",
    label: "Pages",
    lifecycle: false,
  };
  const count: DashboardWidget = {
    id: "core/count",
    title: "Count",
    archetype: "custom",
    size: "sm",
    settings: [
      { name: "collection", label: "Collection", type: "collection" },
      { name: "filter", label: "Filter", type: "filter", of: "collection" },
    ],
    cells: [
      {
        key: "split",
        when: "lifecycle",
        query: { op: "groupBy", groupBy: "status", status: "all" },
      },
      { key: "total", when: "no-lifecycle", query: { op: "count" } },
    ],
  } as DashboardWidget;
  const keys = (widget: DashboardWidget) => widget.cells?.map(cell => cell.key);

  it("asks the cells the collection it is set to answers", () => {
    expect(
      keys(widgetAsAsked(count, { collection: "posts" }, [posts, pages]))
    ).toEqual(["split"]);
    expect(
      keys(widgetAsAsked(count, { collection: "pages" }, [posts, pages]))
    ).toEqual(["total"]);
  });

  it("judges a cell by the collection it declares, with no Collection setting set", () => {
    // 🔴 Judged by the Collection setting alone, an unset one reads as no
    // lifecycle and drops the split this cell reads of posts.
    const declared = {
      ...count,
      cells: [
        {
          key: "split",
          when: "lifecycle",
          query: {
            source: "collection:posts",
            op: "groupBy",
            groupBy: "status",
          },
        },
        {
          key: "total",
          when: "no-lifecycle",
          query: { source: "collection:posts", op: "count" },
        },
      ],
    } as DashboardWidget;
    expect(keys(widgetAsAsked(declared, {}, [posts]))).toEqual(["split"]);
  });

  it("hands the card the Filter its cells were asked with, not a stored one they set aside", () => {
    const stored = { collection: "posts", filter: { salary: { gt: 1 } } };
    expect(settingsAsAsked(count, stored, [posts]).filter).toBeUndefined();
    const kept = { collection: "posts", filter: { title: { equals: "a" } } };
    expect(settingsAsAsked(count, kept, [posts]).filter).toEqual({
      title: { equals: "a" },
    });
  });

  it("is titled by the collection it is set to, and as its widget when set to none", () => {
    expect(titleAsAsked(count, { collection: "posts" }, [posts])).toBe(
      "Count: Posts"
    );
    expect(titleAsAsked(count, { collection: "drafts" }, [posts])).toBe(
      "Count: drafts"
    );
    expect(titleAsAsked(count, {}, [posts])).toBe("Count");
  });
});
