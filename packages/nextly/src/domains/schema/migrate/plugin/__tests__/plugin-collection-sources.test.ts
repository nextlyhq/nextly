/**
 * Which plugin each collection of the configuration belongs to, by the slug the configuration holds
 * it under: the one the host renamed it to (`renameMap`), or the one the plugin declares.
 */
import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "../../../../../plugins/plugin-context";
import { renamePluginContributes } from "../../../../../plugins/schema/apply-contributions";
import { pluginCollectionSources } from "../plugin-collection-sources";

/** A plugin contributing `slugs`, which the host renames by `renameMap`. */
function plugin(
  name: string,
  slugs: string[],
  renameMap?: Record<string, string>
): PluginDefinition {
  return {
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { collections: slugs.map(slug => ({ slug, fields: [] })) },
    ...(renameMap === undefined ? {} : { renameMap }),
  };
}

describe("the plugin a collection belongs to", () => {
  it("is the one that declares its slug, where nothing is renamed", () => {
    expect([...pluginCollectionSources([plugin("@a/one", ["forms"])])]).toEqual(
      [["forms", "plugin:@a/one"]]
    );
  });

  it("is found by the slug the host renamed the collection to, and not by the one it vacated", () => {
    const sources = pluginCollectionSources([
      plugin("@a/one", ["forms", "entries"], { forms: "contact-forms" }),
    ]);
    expect(sources.get("contact-forms")).toBe("plugin:@a/one");
    expect(sources.get("entries")).toBe("plugin:@a/one");
    expect(sources.has("forms")).toBe(false);
  });

  it("is the plugin that took the slug another one vacated", () => {
    const sources = pluginCollectionSources([
      plugin("@a/one", ["forms"], { forms: "contact-forms" }),
      plugin("@a/two", ["forms"]),
    ]);
    expect(sources.get("forms")).toBe("plugin:@a/two");
    expect(sources.get("contact-forms")).toBe("plugin:@a/one");
  });

  it("is found by the declared slug in a record from before the rename", () => {
    // A registry written back from a migration's snapshot holds the slugs of that point.
    const renamed = [plugin("@a/one", ["forms"], { forms: "contact-forms" })];
    expect([
      ...pluginCollectionSources(renamed, { forms: {}, pages: {} }),
    ]).toEqual([["forms", "plugin:@a/one"]]);
    // Whichever plugin took the vacated slug since: the record is from before it could.
    const taken = plugin("@a/two", ["forms"]);
    for (const plugins of [
      [...renamed, taken],
      [taken, ...renamed],
    ]) {
      expect([...pluginCollectionSources(plugins, { forms: {} })]).toEqual([
        ["forms", "plugin:@a/one"],
      ]);
    }
    // With both, the rename was already made: the vacated slug is the app's.
    expect([
      ...pluginCollectionSources(renamed, { forms: {}, "contact-forms": {} }),
    ]).toEqual([["contact-forms", "plugin:@a/one"]]);
    // With neither, the configuration's own answer.
    expect([...pluginCollectionSources(renamed, { pages: {} })]).toEqual([
      ["contact-forms", "plugin:@a/one"],
    ]);
  });

  it("reads a slug named like an object's own method from the map's own keys", () => {
    expect(
      pluginCollectionSources([
        plugin("@a/one", ["constructor", "forms"], { forms: "contact-forms" }),
      ]).get("constructor")
    ).toBe("plugin:@a/one");
  });

  it("names the slugs the configuration's fold gives the same plugin's collections", () => {
    const renamed = plugin("@a/one", ["forms", "entries"], {
      forms: "contact-forms",
    });
    expect([...pluginCollectionSources([renamed]).keys()]).toEqual(
      renamePluginContributes(renamed).collections?.map(({ slug }) => slug)
    );
  });
});
