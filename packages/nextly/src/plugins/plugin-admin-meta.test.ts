import { describe, expect, it } from "vitest";

import type { CollectionConfig } from "../collections/config/define-collection";

import { pluginCollectionSlugs } from "./plugin-admin-meta";
import type { PluginDefinition } from "./plugin-context";

const coll = (slug: string): CollectionConfig =>
  ({ slug, fields: [] }) as unknown as CollectionConfig;

const plugin = (extra: Partial<PluginDefinition>): PluginDefinition => ({
  name: "@t/p",
  version: "1.0.0",
  nextly: ">=0.0.0",
  ...extra,
});

describe("pluginCollectionSlugs (admin-meta sidebar dual-read)", () => {
  it("reads slugs from contributes.collections (P2 path)", () => {
    expect(
      pluginCollectionSlugs(
        plugin({ contributes: { collections: [coll("forms")] } })
      )
    ).toEqual(["forms"]);
  });

  it("still reads slugs from the deprecated top-level collections (legacy)", () => {
    expect(
      pluginCollectionSlugs(plugin({ collections: [coll("legacy")] }))
    ).toEqual(["legacy"]);
  });

  it("dedupes when a slug appears in both sources", () => {
    expect(
      pluginCollectionSlugs(
        plugin({
          contributes: { collections: [coll("forms")] },
          collections: [coll("forms")],
        })
      )
    ).toEqual(["forms"]);
  });

  it("returns an empty array when the plugin owns no collections", () => {
    expect(pluginCollectionSlugs(plugin({}))).toEqual([]);
  });
});
