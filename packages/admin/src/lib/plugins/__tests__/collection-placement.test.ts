/**
 * Placement decides which sidebar section may list a plugin collection, and it
 * is a property of the plugin that OWNS the collection. These cover the inputs
 * where ownership and display grouping come apart: a collection with no
 * `admin.group` heading is still owned, so its placement is still knowable.
 */
import { describe, expect, it } from "vitest";

import {
  isCollectionPlacedElsewhere,
  resolveCollectionPlacement,
} from "../collection-placement";

import type { PluginMetadata } from "@admin/types/branding";

const META = [
  {
    name: "@acme/settings-plugin",
    placement: "settings",
    collections: ["gadgets"],
  },
  { name: "@acme/plain", collections: ["widgets"] },
  { name: "@acme/grouped", group: "settings", collections: ["cogs"] },
] as unknown as PluginMetadata[];

describe("resolveCollectionPlacement", () => {
  it("reads the placement from the plugin that owns the collection", () => {
    expect(resolveCollectionPlacement("gadgets", META)).toBe("settings");
  });

  it("falls back to the plugin's group when no placement is declared", () => {
    expect(resolveCollectionPlacement("cogs", META)).toBe("settings");
  });

  it("is undefined for a plugin declaring neither", () => {
    expect(resolveCollectionPlacement("widgets", META)).toBeUndefined();
  });

  it("is undefined for a collection no plugin claims", () => {
    expect(resolveCollectionPlacement("posts", META)).toBeUndefined();
  });

  it("is undefined when metadata has not loaded", () => {
    expect(resolveCollectionPlacement("gadgets", undefined)).toBeUndefined();
  });
});

describe("isCollectionPlacedElsewhere", () => {
  /**
   * The separating case. `gadgets` carries no `admin.group`, so a lookup keyed
   * on the display group cannot find its plugin and reports no placement —
   * which reads as "belongs under Plugins" and lists it there as well as under
   * Settings. Nothing about this answer involves the group.
   */
  it("finds a placement for a collection that declares no display group", () => {
    expect(isCollectionPlacedElsewhere("gadgets", META)).toBe(true);
  });

  /**
   * An undeclared placement means Plugins, not "unknown, so hide it". Treating
   * it as elsewhere would remove the collection from every section.
   */
  it("keeps a collection whose plugin declares no placement", () => {
    expect(isCollectionPlacedElsewhere("widgets", META)).toBe(false);
  });

  it("keeps one placed in Plugins explicitly", () => {
    const explicit = [
      { name: "@acme/here", placement: "plugins", collections: ["here"] },
    ] as unknown as PluginMetadata[];

    expect(isCollectionPlacedElsewhere("here", explicit)).toBe(false);
  });

  it("keeps a collection no plugin claims", () => {
    expect(isCollectionPlacedElsewhere("posts", META)).toBe(false);
  });
});
