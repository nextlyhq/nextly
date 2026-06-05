import { describe, expect, it } from "vitest";

import { buildDesiredTableFromFields } from "../build-from-fields";

function idxNames(t: { indexes?: { name: string; unique: boolean }[] }) {
  return (t.indexes ?? []).map(i => `${i.name}:${i.unique ? "u" : "n"}`).sort();
}

describe("buildDesiredTableFromFields — indexes", () => {
  it("emits unique/plain/relationship/system indexes", () => {
    const t = buildDesiredTableFromFields(
      "dc_posts",
      [
        { name: "title", type: "text" },
        { name: "slug", type: "text" },
        { name: "email", type: "email", unique: true },
        { name: "views", type: "number", index: true },
        { name: "author", type: "relationship", relationTo: "authors" },
        {
          name: "tags",
          type: "relationship",
          relationTo: "authors",
          hasMany: true,
        },
      ] as never,
      "postgresql",
      {}
    );
    expect(idxNames(t)).toEqual(
      [
        "idx_dc_posts_author:n", // single relationship auto-index
        "idx_dc_posts_created_at:n", // system
        "idx_dc_posts_slug:u", // system unique
        "idx_dc_posts_views:n", // user index
        "uq_dc_posts_email:u", // user unique
      ].sort()
    );
    // hasMany relationship (json column) gets NO index:
    expect(idxNames(t)).not.toContain("idx_dc_posts_tags:n");
  });

  it("dedupes the slug index when a unique slug field collides with the system index", () => {
    // defineCollection injects a `slug` field with unique:true; the system also
    // adds idx_<t>_slug (unique). Only ONE unique slug index should result.
    const t = buildDesiredTableFromFields(
      "dc_posts",
      [
        { name: "title", type: "text" },
        { name: "slug", type: "text", unique: true },
        { name: "body", type: "text" },
      ] as never,
      "postgresql",
      {}
    );
    const slugIndexes = (t.indexes ?? []).filter(i =>
      i.columns.includes("slug")
    );
    expect(slugIndexes).toHaveLength(1);
  });
});
