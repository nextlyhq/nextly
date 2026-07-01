/**
 * @module domains/schema/ui-schema/merge.test
 * @since v0.0.3-alpha (Plan D2)
 */
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";
import { uiSchemaManifest } from "../../../schemas/_zod/ui-schema";
import type { MinimalConfigEntity } from "../migrate-create/generate";

import { applyDeferredExtendsToManifest, mergeUiEntities } from "./merge";

const seoField = (name: string): FieldConfig =>
  ({ name, type: "text" }) as unknown as FieldConfig;

const codeCollection: MinimalConfigEntity = {
  slug: "posts",
  tableName: "dc_posts",
  fields: [{ name: "title", type: "text", required: true }],
  status: false,
};

describe("mergeUiEntities", () => {
  it("appends UI-only entities after code entities", () => {
    const manifest = uiSchemaManifest.parse({
      collections: [
        { slug: "events", fields: [{ name: "title", type: "text" }] },
      ],
    });
    const r = mergeUiEntities({
      codeCollections: [codeCollection],
      codeSingles: [],
      codeComponents: [],
      manifest,
    });
    expect(r.collections.map(c => c.slug)).toEqual(["posts", "events"]);
    expect(r.collections[1].tableName).toBe("dc_events");
    expect(r.droppedUiSlugs).toEqual([]);
  });

  it("drops a UI entity whose slug collides with code (code-first wins)", () => {
    const manifest = uiSchemaManifest.parse({
      collections: [
        { slug: "posts", fields: [{ name: "body", type: "text" }] },
      ],
    });
    const r = mergeUiEntities({
      codeCollections: [codeCollection],
      codeSingles: [],
      codeComponents: [],
      manifest,
    });
    expect(r.collections).toHaveLength(1);
    expect(r.collections[0].fields.map(f => f.name)).toContain("title"); // code kept
    expect(r.droppedUiSlugs).toEqual(["posts"]);
  });

  it("maps singles/components to their prefixes", () => {
    const manifest = uiSchemaManifest.parse({
      singles: [{ slug: "home", fields: [{ name: "hero", type: "text" }] }],
      components: [
        { slug: "seo", fields: [{ name: "meta_title", type: "text" }] },
      ],
    });
    const r = mergeUiEntities({
      codeCollections: [],
      codeSingles: [],
      codeComponents: [],
      manifest,
    });
    expect(r.singles[0].tableName).toBe("single_home");
    expect(r.components[0].tableName).toBe("comp_seo");
  });

  it("materializes a plugin's deferred extend onto the Builder entity, flowing into the merged MinimalConfigEntity (P8)", () => {
    const manifest = uiSchemaManifest.parse({
      collections: [
        { slug: "pages", fields: [{ name: "title", type: "text" }] },
      ],
    });
    const extended = applyDeferredExtendsToManifest(manifest, [
      {
        target: "pages",
        fields: [seoField("metaTitle")],
        owner: "@acme/plugin-example",
      },
    ]);
    // ui-schema entity now carries the plugin field → dynamic_collections.fields.
    expect(extended.collections[0].fields.map(f => f.name)).toEqual([
      "title",
      "metaTitle",
    ]);
    // ...and it flows into the migration table input → generateMigration ADD COLUMN.
    const merged = mergeUiEntities({
      codeCollections: [],
      codeSingles: [],
      codeComponents: [],
      manifest: extended,
    });
    expect(merged.collections[0].fields.map(f => f.name)).toEqual([
      "title",
      "metaTitle",
    ]);
  });

  it("returns the manifest unchanged when there are no deferred extends (P8)", () => {
    const manifest = uiSchemaManifest.parse({
      collections: [{ slug: "pages", fields: [] }],
    });
    expect(applyDeferredExtendsToManifest(manifest, [])).toBe(manifest);
  });

  it("throws for a deferred extend target matching no Builder entity (P8 typo guard)", () => {
    const manifest = uiSchemaManifest.parse({
      collections: [{ slug: "pages", fields: [] }],
    });
    expect(() =>
      applyDeferredExtendsToManifest(manifest, [
        { target: "ghost", fields: [seoField("x")], owner: "@t/x" },
      ])
    ).toThrow();
  });

  it("forwards a UI collection's status: true into the merged MinimalConfigEntity", () => {
    const manifest = uiSchemaManifest.parse({
      collections: [
        {
          slug: "stories",
          status: true,
          fields: [{ name: "body", type: "text" }],
        },
      ],
    });
    const merged = mergeUiEntities({
      codeCollections: [],
      codeSingles: [],
      codeComponents: [],
      manifest,
    });
    const stories = merged.collections.find(c => c.slug === "stories");
    expect(stories?.status).toBe(true);
    expect(stories?.tableName).toBe("dc_stories");
  });
});
