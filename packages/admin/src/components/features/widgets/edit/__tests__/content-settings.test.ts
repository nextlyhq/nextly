/**
 * Which settings follow a collection, and which stored values name a field
 * the reader may no longer be offered.
 */
import type { AnyWidgetSetting, PublishedContentSource } from "nextly/config";
import { describe, expect, it } from "vitest";

import {
  dependentsOf,
  fieldsNamedBy,
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
    lifecycle: false,
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
    lifecycle: false,
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

  it("each name the fields their value refers to", () => {
    const [where, order, by] = dependentsOf(settings, "collection");
    expect(fieldsNamedBy(order!, "-title")).toEqual(["title"]);
    expect(fieldsNamedBy(order!, "title")).toEqual(["title"]);
    expect(fieldsNamedBy(by!, "state")).toEqual(["state"]);
    expect(fieldsNamedBy(where!, { title: { equals: "a" } })).toEqual([
      "title",
    ]);
    expect(fieldsNamedBy(by!, undefined)).toEqual([]);
  });

  it("names every field a Fields setting chose, in order", () => {
    const shown = {
      name: "shown",
      type: "fields" as const,
      of: "collection",
    };
    expect(fieldsNamedBy(shown, ["state", "title"])).toEqual([
      "state",
      "title",
    ]);
    expect(fieldsNamedBy(shown, undefined)).toEqual([]);
  });
});

describe("a stored value naming a field no longer offered", () => {
  it("is found for a Fields setting by the one chosen field it may not show", () => {
    // 🔴 `salary` is not among the fields Posts offers this reader: the choice is reset
    // to none, so the card falls back to its own fields rather than ask for it.
    const withFields: AnyWidgetSetting[] = [
      ...settings,
      { name: "shown", type: "fields", of: "collection", label: "Fields" },
    ];
    expect(
      staleContentValues(
        withFields,
        { collection: "posts", shown: ["title", "salary"] },
        sources
      )
    ).toEqual([
      {
        name: "shown",
        notice: "Fields was reset: salary is no longer available",
        replacement: [],
      },
    ]);
    expect(
      staleContentValues(
        withFields,
        { collection: "posts", shown: ["title", "updatedAt"] },
        sources
      )
    ).toEqual([]);
  });

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
