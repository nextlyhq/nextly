/**
 * @module domains/schema/ui-schema/to-snapshot.test
 * @since v0.0.3-alpha (Plan D1)
 */
import { describe, expect, it } from "vitest";

import { uiSchemaManifest } from "../../../schemas/_zod/ui-schema";

import { uiSchemaToSnapshot } from "./to-snapshot";

const manifest = uiSchemaManifest.parse({
  version: 1,
  collections: [
    {
      slug: "blog-posts",
      fields: [{ name: "title", type: "text", required: true }],
    },
  ],
  singles: [{ slug: "home", fields: [{ name: "hero", type: "text" }] }],
  components: [{ slug: "seo", fields: [{ name: "meta_title", type: "text" }] }],
});

describe("uiSchemaToSnapshot", () => {
  it("maps collections/singles/components to dc_/single_/comp_ tables", () => {
    const snap = uiSchemaToSnapshot(manifest, "sqlite");
    const names = snap.tables.map(t => t.name).sort();
    expect(names).toContain("dc_blog_posts"); // dashes → underscores
    expect(names).toContain("single_home");
    expect(names).toContain("comp_seo");
  });

  it("includes the user field as a column on the data table", () => {
    const snap = uiSchemaToSnapshot(manifest, "sqlite");
    const dc = snap.tables.find(t => t.name === "dc_blog_posts");
    expect(dc?.columns.some(c => c.name === "title")).toBe(true);
  });

  it("returns an empty snapshot for an empty manifest", () => {
    const snap = uiSchemaToSnapshot(uiSchemaManifest.parse({}), "sqlite");
    expect(snap.tables).toEqual([]);
  });
});
