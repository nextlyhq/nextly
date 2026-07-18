/**
 * @module lib/builder/plugin-field-type-entries.test
 */
import { describe, expect, it } from "vitest";

import type { PluginMetadata } from "@admin/types/branding";

import { pluginFieldTypeCatalogEntries } from "./plugin-field-type-entries";

/** Minimal plugin metadata carrying only the field types under test. */
function pluginWith(
  fieldTypes: NonNullable<PluginMetadata["fieldTypes"]>
): PluginMetadata {
  return { name: "@acme/plugin", collections: [], fieldTypes };
}

describe("pluginFieldTypeCatalogEntries", () => {
  it("returns [] when there are no plugins or no field types", () => {
    expect(pluginFieldTypeCatalogEntries(undefined, "entries")).toEqual([]);
    expect(pluginFieldTypeCatalogEntries([], "entries")).toEqual([]);
    expect(
      pluginFieldTypeCatalogEntries([{ name: "p", collections: [] }], "entries")
    ).toEqual([]);
  });

  it("projects a plugin field type into a catalog entry with its presentation", () => {
    const plugins = [
      pluginWith([
        {
          type: "rating",
          component: "RatingInput",
          label: "Star Rating",
          description: "A 1-5 star rating",
          icon: "Star",
          category: "Advanced",
          surfaces: ["entries"],
        },
      ]),
    ];

    expect(pluginFieldTypeCatalogEntries(plugins, "entries")).toEqual([
      {
        type: "rating",
        label: "Star Rating",
        category: "Advanced",
        hint: "A 1-5 star rating",
        icon: "Star",
      },
    ]);
  });

  it("fills sensible defaults when presentation fields are omitted", () => {
    const plugins = [
      pluginWith([
        { type: "star-rating", component: "C", surfaces: ["entries"] },
      ]),
    ];

    expect(pluginFieldTypeCatalogEntries(plugins, "entries")).toEqual([
      {
        type: "star-rating",
        // title-cased id
        label: "Star Rating",
        // default category + icon, empty hint
        category: "Advanced",
        hint: "",
        icon: "Puzzle",
      },
    ]);
  });

  it("treats an omitted surfaces list as the entries surface only", () => {
    const plugins = [pluginWith([{ type: "rating", component: "C" }])];

    expect(pluginFieldTypeCatalogEntries(plugins, "entries")).toHaveLength(1);
    expect(pluginFieldTypeCatalogEntries(plugins, "users")).toEqual([]);
    expect(pluginFieldTypeCatalogEntries(plugins, "forms")).toEqual([]);
  });

  it("offers a type only on the surfaces it opted into", () => {
    const plugins = [
      pluginWith([
        { type: "rating", component: "C", surfaces: ["users", "forms"] },
      ]),
    ];

    expect(pluginFieldTypeCatalogEntries(plugins, "entries")).toEqual([]);
    expect(pluginFieldTypeCatalogEntries(plugins, "users")).toHaveLength(1);
    expect(pluginFieldTypeCatalogEntries(plugins, "forms")).toHaveLength(1);
  });

  it("excludes a disabled plugin's field types from picker entries", () => {
    const plugins: PluginMetadata[] = [
      {
        name: "@acme/disabled",
        collections: [],
        enabled: false,
        fieldTypes: [{ type: "rating", component: "C", surfaces: ["entries"] }],
      },
      {
        name: "@acme/enabled",
        collections: [],
        enabled: true,
        fieldTypes: [{ type: "color", component: "C", surfaces: ["entries"] }],
      },
    ];
    expect(
      pluginFieldTypeCatalogEntries(plugins, "entries").map(e => e.type)
    ).toEqual(["color"]);
  });

  it("flattens field types across multiple plugins in registration order", () => {
    const plugins = [
      pluginWith([{ type: "rating", component: "C", surfaces: ["entries"] }]),
      pluginWith([{ type: "color", component: "C", surfaces: ["entries"] }]),
    ];

    expect(
      pluginFieldTypeCatalogEntries(plugins, "entries").map(e => e.type)
    ).toEqual(["rating", "color"]);
  });
});
