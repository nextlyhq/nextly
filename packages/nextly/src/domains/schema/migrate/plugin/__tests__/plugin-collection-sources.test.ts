/**
 * Which plugin each collection of the configuration belongs to, by the slug the configuration holds
 * it under: the one the host renamed it to (`renameMap`), or the one the plugin declares.
 */
import { describe, expect, it } from "vitest";

import type { PluginDefinition } from "../../../../../plugins/plugin-context";
import { renamePluginContributes } from "../../../../../plugins/schema/apply-contributions";
import {
  collectionOwner,
  declaredEntitySources,
  pluginCollectionSources,
  pluginEntitySources,
} from "../plugin-collection-sources";

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

  it("is found by the slug the plugin declares where a rollback asks, whatever the host renamed", () => {
    expect([
      ...declaredEntitySources([
        plugin("@a/one", ["forms", "entries"], { forms: "contact-forms" }),
      ]).collections,
    ]).toEqual([
      ["forms", "plugin:@a/one"],
      ["entries", "plugin:@a/one"],
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

describe("the plugin a Single or a field group belongs to", () => {
  /** A plugin contributing one entity of each kind, which the host renames by `renameMap`. */
  function contributesAll(
    renameMap?: Record<string, string>
  ): PluginDefinition {
    return {
      name: "@a/one",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        collections: [{ slug: "events", fields: [] }],
        singles: [{ slug: "settings", fields: [] }],
        fieldGroups: [{ slug: "hero", fields: [] }],
      },
      ...(renameMap === undefined ? {} : { renameMap }),
    };
  }

  /** `sources` as plain objects. */
  function plain(sources: ReturnType<typeof pluginEntitySources>) {
    return {
      collections: Object.fromEntries(sources.collections),
      singles: Object.fromEntries(sources.singles),
      fieldGroups: Object.fromEntries(sources.fieldGroups),
    };
  }

  it("is the one that declares its slug, each kind on its own", () => {
    expect(plain(pluginEntitySources([contributesAll()]))).toEqual({
      collections: { events: "plugin:@a/one" },
      singles: { settings: "plugin:@a/one" },
      fieldGroups: { hero: "plugin:@a/one" },
    });
  });

  it("is found by the slug the host renamed it to, as the configuration's fold names it", () => {
    const renamed = contributesAll({
      settings: "shop-settings",
      hero: "shop-hero",
    });
    const fold = renamePluginContributes(renamed);

    expect([...pluginEntitySources([renamed]).singles.keys()]).toEqual(
      fold.singles?.map(({ slug }) => slug)
    );
    expect([...pluginEntitySources([renamed]).fieldGroups.keys()]).toEqual(
      fold.fieldGroups?.map(({ slug }) => slug)
    );
  });

  it("is found by the slug the plugin declares where a rollback asks", () => {
    const sources = declaredEntitySources([
      contributesAll({ settings: "shop-settings", hero: "shop-hero" }),
    ]);
    expect([...sources.singles.keys()]).toEqual(["settings"]);
    expect([...sources.fieldGroups.keys()]).toEqual(["hero"]);
  });
});

describe("a collection under a plugin's legacy `collections` key", () => {
  const legacy = {
    name: "@a/old",
    version: "1.0.0",
    nextly: ">=0.0.0",
    collections: [{ slug: "events", fields: [] }],
    renameMap: { events: "shows" },
  } as unknown as PluginDefinition;

  it("is the plugin's by the slug it declares, which no rename reaches", () => {
    for (const sources of [pluginEntitySources, declaredEntitySources]) {
      expect([...sources([legacy]).collections]).toEqual([
        ["events", "plugin:@a/old"],
      ]);
    }
  });

  it("yields to the Schema Builder, where one a plugin contributes is taken back", () => {
    const sources = pluginEntitySources([
      legacy,
      plugin("@a/one", ["forms"], { forms: "contact-forms" }),
    ]);

    expect(collectionOwner(sources, "events")).toEqual({
      source: "plugin:@a/old",
      yieldsToBuilder: true,
    });
    expect(collectionOwner(sources, "contact-forms")).toEqual({
      source: "plugin:@a/one",
    });
    expect(collectionOwner(sources, "posts")).toEqual({ source: "code" });
    // So it is none of those a demote refuses, or a push keeps from the Builder.
    expect([...pluginCollectionSources([legacy])]).toEqual([]);
  });

  it("names no slug the same plugin contributes and the host renamed, which is the app's to take", () => {
    const both = {
      ...plugin("@a/one", ["forms"], { forms: "contact-forms" }),
      collections: [{ slug: "forms", fields: [] }],
    } as unknown as PluginDefinition;

    expect([...pluginCollectionSources([both])]).toEqual([
      ["contact-forms", "plugin:@a/one"],
    ]);
  });

  it("gives way to the plugin that contributes the slug, whatever their order", () => {
    const contributing = plugin("@a/one", ["events"]);
    for (const plugins of [
      [legacy, contributing],
      [contributing, legacy],
    ]) {
      expect(pluginCollectionSources(plugins).get("events")).toBe(
        "plugin:@a/one"
      );
    }
  });
});
