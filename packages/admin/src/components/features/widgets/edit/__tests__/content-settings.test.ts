/**
 * Which settings follow a collection, and which stored values name a field
 * the reader may no longer be offered.
 */
import type { AnyWidgetSetting, PublishedContentSource } from "nextly/config";
import { describe, expect, it } from "vitest";

import {
  dependentsOf,
  fieldNamedBy,
  staleContentValues,
} from "../content-settings";

const settings: AnyWidgetSetting[] = [
  { name: "collection", type: "collection", label: "Collection" },
  { name: "where", type: "filter", of: "collection", label: "Filter" },
  {
    name: "order",
    type: "sort",
    of: "collection",
    label: "Sort",
    defaultValue: "-updatedAt",
  },
  { name: "by", type: "groupBy", of: "collection", label: "Group by" },
  { name: "items", type: "number", label: "Number of items" },
];

const sources: PublishedContentSource[] = [
  {
    collection: "posts",
    label: "Posts",
    fields: [
      { name: "title", type: "string" },
      { name: "updatedAt", type: "date" },
      // Offered to filter and sort; the read will not group by it.
      { name: "headline", type: "string", groupable: false },
    ],
  },
  {
    collection: "pages",
    label: "Pages",
    fields: [{ name: "title", type: "string" }],
  },
];

describe("the settings that follow a collection", () => {
  it("are the dependents naming it, and nothing else", () => {
    expect(dependentsOf(settings, "collection").map(s => s.name)).toEqual([
      "where",
      "order",
      "by",
    ]);
    expect(dependentsOf(settings, "other")).toEqual([]);
  });

  it("each name the field their value refers to", () => {
    const [where, order, by] = dependentsOf(settings, "collection");
    expect(fieldNamedBy(order!, "-title")).toBe("title");
    expect(fieldNamedBy(order!, "title")).toBe("title");
    expect(fieldNamedBy(by!, "state")).toBe("state");
    expect(fieldNamedBy(where!, { title: { equals: "a" } })).toBe("title");
    expect(fieldNamedBy(by!, undefined)).toBeUndefined();
  });
});

describe("a stored value naming a field no longer offered", () => {
  it("is reported with the sheet's one line", () => {
    expect(
      staleContentValues(
        settings,
        { collection: "posts", by: "state", order: "-title" },
        sources
      )
    ).toEqual([
      {
        name: "by",
        notice: "Group by was reset: state is no longer available",
        // No default declared, so none.
        replacement: "",
      },
    ]);
  });

  it("covers a Group by naming a field the read will not group by", () => {
    expect(
      staleContentValues(
        settings,
        {
          collection: "posts",
          by: "headline",
          where: { headline: { equals: "a" } },
        },
        sources
      ).map(stale => stale.name)
    ).toEqual(["by"]);
  });

  it("judges a default as well, and replaces one the collection lacks with none", () => {
    // Pages has no updatedAt, so Sort's default names nothing there.
    expect(
      staleContentValues(
        settings,
        { collection: "pages", order: "-updatedAt" },
        sources
      )
    ).toEqual([
      {
        name: "order",
        notice: "Sort's default, updatedAt, is not available for Pages",
        replacement: "",
      },
    ]);
  });

  it("replaces a stale stored value with the default where the default fits", () => {
    expect(
      staleContentValues(
        settings,
        { collection: "posts", order: "-gone" },
        sources
      )
    ).toEqual([
      expect.objectContaining({ name: "order", replacement: "-updatedAt" }),
    ]);
  });

  it("covers a filter whose field is gone", () => {
    expect(
      staleContentValues(
        settings,
        { collection: "posts", where: { secret: { equals: "x" } } },
        sources
      ).map(stale => stale.name)
    ).toEqual(["where"]);
  });

  it("resets a Collection the reader is no longer offered, and leaves a default naming none alone", () => {
    expect(
      staleContentValues(settings, { collection: "gone" }, sources)
    ).toEqual([
      {
        name: "collection",
        notice: "Collection was reset: gone is no longer available",
        replacement: "",
      },
    ]);
    const anyCollection: AnyWidgetSetting[] = [
      { name: "collection", type: "collection", defaultValue: "*" },
    ];
    expect(
      staleContentValues(anyCollection, { collection: "*" }, sources)
    ).toEqual([]);
  });

  it("leaves every value alone while the sources have not arrived", () => {
    expect(
      staleContentValues(
        settings,
        { collection: "posts", by: "state" },
        undefined
      )
    ).toEqual([]);
  });

  it("leaves a default, and a value naming an offered field, alone", () => {
    expect(
      staleContentValues(
        settings,
        { collection: "posts", order: "-updatedAt", by: "title" },
        sources
      )
    ).toEqual([]);
  });
});
