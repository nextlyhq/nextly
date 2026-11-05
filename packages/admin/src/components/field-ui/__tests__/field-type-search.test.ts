// How the shared field picker finds a type. Each case runs on the real catalog
// as the picker receives it (`describeFieldTypes` over the shipped rows), so a
// synonym missing from the description fails here, not only a search defect.
import type {
  FieldTypeCatalogEntry,
  FieldTypeDescription,
} from "nextly/field-catalog";
import { describeFieldTypes, FIELD_TYPE_CATALOG } from "nextly/field-catalog";
import { describe, expect, it } from "vitest";

import {
  groupFieldTypes,
  offeredFieldTypes,
  searchFieldTypes,
} from "../field-type-search";

const CATALOG = describeFieldTypes<string>(FIELD_TYPE_CATALOG);

const typesOf = (types: readonly { type: string }[] | null) =>
  types === null ? null : types.map(t => t.type);

const pluginRow = (
  type: string,
  over: Partial<FieldTypeCatalogEntry<string>> = {}
): FieldTypeCatalogEntry<string> => ({
  type,
  label: type,
  category: "Advanced",
  hint: "",
  icon: "Puzzle",
  ...over,
});

describe("searchFieldTypes", () => {
  // Older Nextly names and developer names find today's plain name, ranked
  // first, so Enter on the search picks the type the person meant.
  it.each([
    ["relationship", "relationship"],
    ["repeater", "repeater"],
    ["image", "upload"],
    ["media", "upload"],
    ["editor", "richText"],
    ["component", "component"],
    ["dropdown", "select"],
    ["boolean", "checkbox"],
    ["tags", "chips"],
  ])("%s finds %s first", (query, expected) => {
    expect(searchFieldTypes(CATALOG, query)?.[0]?.type).toBe(expected);
  });

  it("matches without regard to case or surrounding spaces", () => {
    expect(typesOf(searchFieldTypes(CATALOG, "  IMAGE "))).toEqual(
      typesOf(searchFieldTypes(CATALOG, "image"))
    );
  });

  it("ranks a name above a synonym above a description, not catalog order", () => {
    // Tags precedes Repeating rows in the catalog; "list" is only in the tags
    // description, while it is a synonym of repeating rows.
    expect(typesOf(searchFieldTypes(CATALOG, "list"))).toEqual([
      "repeater",
      "chips",
    ]);
  });

  it("lists every type whose name, synonym or description matches, once each", () => {
    expect(typesOf(searchFieldTypes(CATALOG, "text"))).toEqual([
      "text",
      "textarea",
      "richText",
    ]);
  });

  it("ranks a name that starts with the query above one that contains it, whatever the input order", () => {
    const reversed = [
      ...CATALOG.filter(t => t.type === "textarea"),
      ...CATALOG.filter(t => t.type === "text"),
    ];
    expect(typesOf(searchFieldTypes(reversed, "text"))).toEqual([
      "text",
      "textarea",
    ]);
  });

  it("finds a type by words that are only in its description", () => {
    // Neither word is in a name or synonym, and the phrase is not in the
    // description as written ("Single-line input").
    expect(typesOf(searchFieldTypes(CATALOG, "single input"))).toEqual([
      "text",
    ]);
  });

  it("finds a type when every word of the query matches somewhere", () => {
    expect(typesOf(searchFieldTypes(CATALOG, "link entries"))).toEqual([
      "relationship",
    ]);
  });

  it("matches a category", () => {
    expect(typesOf(searchFieldTypes(CATALOG, "relational"))).toEqual([
      "relationship",
    ]);
  });

  it("returns null for an empty query and an empty list for no match", () => {
    expect(searchFieldTypes(CATALOG, "")).toBeNull();
    expect(searchFieldTypes(CATALOG, "   ")).toBeNull();
    expect(searchFieldTypes(CATALOG, "zzzz")).toEqual([]);
  });

  it("finds a plugin type by its id as well as its name", () => {
    const offered = offeredFieldTypes(CATALOG, [
      pluginRow("star-rating", { label: "Stars" }),
    ]);
    expect(typesOf(searchFieldTypes(offered, "star-rating"))).toEqual([
      "star-rating",
    ]);
    expect(typesOf(searchFieldTypes(offered, "stars"))).toEqual([
      "star-rating",
    ]);
  });
});

describe("offeredFieldTypes", () => {
  const builtIns = CATALOG.filter(t => t.type !== "password");

  it("adds plugin types after the built-ins, described the same way", () => {
    const offered = offeredFieldTypes(builtIns, [pluginRow("rating")]);
    expect(typesOf(offered)).toEqual([...typesOf(builtIns)!, "rating"]);
    expect(offered.at(-1)).toEqual({
      ...pluginRow("rating"),
      synonyms: ["rating"],
    });
  });

  it("lets a built-in win a type id, whether or not this surface offers it", () => {
    const offered = offeredFieldTypes(builtIns, [
      pluginRow("text", { label: "Plugin text" }),
      pluginRow("password", { label: "Plugin password" }),
    ]);
    expect(typesOf(offered)).toEqual(typesOf(builtIns));
    expect(offered.find(t => t.type === "text")?.label).toBe("Text");
  });

  it("never lets a plugin take a built-in id from another surface or a field group spelling", () => {
    const offered = offeredFieldTypes(builtIns, [
      pluginRow("phone"),
      pluginRow("fieldGroup"),
      pluginRow("rating"),
    ]);
    expect(typesOf(offered)).toEqual([...typesOf(builtIns)!, "rating"]);
  });

  it("drops excluded types, built-in or plugin", () => {
    const offered = offeredFieldTypes(
      builtIns,
      [pluginRow("rating"), pluginRow("map")],
      ["text", "rating"]
    );
    expect(typesOf(offered)).toEqual([
      ...typesOf(builtIns)!.filter(t => t !== "text"),
      "map",
    ]);
  });
});

describe("groupFieldTypes", () => {
  const headingsAndTypes = (types: readonly FieldTypeDescription<string>[]) =>
    groupFieldTypes(types, ["date", "text", "missing"]).map(g => [
      g.heading,
      typesOf(g.types),
    ]);

  it("shows the most-used group first, then each category, each type once", () => {
    const types = CATALOG.filter(t =>
      ["text", "number", "date", "select", "upload"].includes(t.type)
    );
    expect(headingsAndTypes(types)).toEqual([
      ["Most used", ["date", "text"]],
      ["Basic", ["number"]],
      ["Advanced", ["select"]],
      ["Media", ["upload"]],
    ]);
  });

  it("shows no most-used group when the surface offers none of them", () => {
    const types = CATALOG.filter(t => t.type === "json");
    expect(headingsAndTypes(types)).toEqual([["Advanced", ["json"]]]);
  });

  it("keeps a type whose category the picker does not know, after the rest", () => {
    const odd = {
      ...pluginRow("dial"),
      category: "Gadgets" as FieldTypeCatalogEntry["category"],
      synonyms: ["dial"],
    };
    const types = [...CATALOG.filter(t => t.type === "json"), odd];
    expect(headingsAndTypes(types)).toEqual([
      ["Advanced", ["json"]],
      ["Gadgets", ["dial"]],
    ]);
  });
});
