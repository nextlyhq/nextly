/**
 * @module domains/schema/ui-schema/merge.test
 * @since v0.0.3-alpha (Plan D2)
 */
import { describe, expect, it } from "vitest";

import { uiSchemaManifest } from "../../../schemas/_zod/ui-schema";
import type { MinimalConfigEntity } from "../migrate-create/generate";

import { mergeUiEntities } from "./merge";

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
