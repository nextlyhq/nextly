import { describe, expect, it } from "vitest";

import { DynamicCollectionSchemaService } from "../../../../dynamic-collections/services/dynamic-collection-schema-service";
import {
  buildDesiredTableFromComponentFields,
  buildDesiredTableFromFields,
} from "../build-from-fields";

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
      { builtBy: "codeFirst" }
    );
    expect(idxNames(t)).toEqual(
      [
        "idx_dc_posts_author:n", // single relationship auto-index
        "idx_dc_posts_created_at:n",
        // Owner index: the collection service creates it for every table with
        // the created_by column, so the snapshot records it too.
        "idx_dc_posts_created_by:n", // system
        "idx_dc_posts_slug:u", // system unique
        "idx_dc_posts_views:n", // user index
        "uq_dc_posts_email:u", // user unique
      ].sort()
    );
    // hasMany relationship (json column) gets NO index:
    expect(idxNames(t)).not.toContain("idx_dc_posts_tags:n");
  });

  it("never indexes a component field (it has no parent column)", () => {
    const t = buildDesiredTableFromFields(
      "dc_posts",
      [
        { name: "title", type: "text" },
        { name: "hero", type: "component", unique: true, index: true },
      ] as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );
    expect(t.columns.some(c => c.name === "hero")).toBe(false);
    expect(idxNames(t)).not.toContain("uq_dc_posts_hero:u");
    expect(idxNames(t)).not.toContain("idx_dc_posts_hero:n");
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
      { builtBy: "codeFirst" }
    );
    const slugIndexes = (t.indexes ?? []).filter(i =>
      i.columns.includes("slug")
    );
    expect(slugIndexes).toHaveLength(1);
  });

  // A Builder relationship as the collection and Single creator receives it, one-to-one or not.
  const builderRelation = (relationType: string) => ({
    name: "profile",
    type: "relationship",
    options: { target: "people", relationType, onDelete: "set null" },
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "declares a Builder one-to-one's column unique, as its creator makes it (%s)",
    dialect => {
      const fields = [
        { name: "title", type: "text" },
        builderRelation("oneToOne"),
      ];
      // The creator's own DDL makes the column unique by the relation's cardinality, with a named
      // unique index beside the plain one every relationship gets...
      const emitted = new DynamicCollectionSchemaService(
        undefined,
        dialect
      ).generateMigrationSQL("dc_posts", fields as never);
      expect(emitted).toMatch(
        /CREATE UNIQUE INDEX[^\n]*[`"]uq_dc_posts_profile[`"][^\n]*[`"]profile[`"]/i
      );
      expect(emitted).toMatch(
        /CREATE INDEX[^\n]*[`"]idx_dc_posts_profile[`"]/i
      );

      // ...so the desired schema a migration is written from declares the same two, or the
      // migration creates the column without its uniqueness and the table takes two rows naming
      // one entry.
      const t = buildDesiredTableFromFields(
        "dc_posts",
        fields as never,
        dialect,
        {
          builtBy: "collection",
        }
      );
      expect(idxNames(t)).toContain("uq_dc_posts_profile:u");
      expect(idxNames(t)).toContain("idx_dc_posts_profile:n");
    }
  );

  it("keeps a Builder many-to-one's column a plain index, and a code-first table on the flag alone", () => {
    const manyToOne = buildDesiredTableFromFields(
      "dc_posts",
      [{ name: "title", type: "text" }, builderRelation("manyToOne")] as never,
      "postgresql",
      { builtBy: "collection" }
    );
    expect(idxNames(manyToOne)).toContain("idx_dc_posts_profile:n");
    expect(idxNames(manyToOne)).not.toContain("uq_dc_posts_profile:u");

    // The code-first creator reads the `unique` flag alone, whatever a relationship's options say.
    const codeFirst = buildDesiredTableFromFields(
      "dc_posts",
      [{ name: "title", type: "text" }, builderRelation("oneToOne")] as never,
      "postgresql",
      { builtBy: "codeFirst" }
    );
    expect(idxNames(codeFirst)).not.toContain("uq_dc_posts_profile:u");
  });
});

// "Unique" on a relation holding a list of references would mean no two entries hold the identical
// list, and a btree over a long list refuses the save on PostgreSQL. Such a field declares no
// unique index on any dialect; a relation to one entry, or one polymorphic reference, keeps it.
describe("buildDesiredTableFromFields — a unique relation holding a list", () => {
  const fields = [
    {
      name: "tags",
      type: "relationship",
      relationTo: "tags",
      hasMany: true,
      unique: true,
    },
    {
      name: "files",
      type: "upload",
      relationTo: "media",
      hasMany: true,
      unique: true,
    },
    {
      name: "refs",
      type: "relationship",
      relationTo: ["a", "b"],
      hasMany: true,
      unique: true,
    },
    { name: "owner", type: "relationship", relationTo: "users", unique: true },
    {
      name: "pick",
      type: "relationship",
      relationTo: ["a", "b"],
      unique: true,
    },
  ];

  for (const dialect of ["postgresql", "sqlite"] as const) {
    it(`declares no unique index for a list, and keeps one for a single reference (${dialect})`, () => {
      const unique = (
        buildDesiredTableFromFields("dc_posts", fields as never, dialect, {
          builtBy: "codeFirst",
        }).indexes ?? []
      )
        .filter(index => index.unique && index.name.startsWith("uq_"))
        .map(index => index.name)
        .sort();
      expect(unique).toEqual(["uq_dc_posts_owner", "uq_dc_posts_pick"]);
    });

    it(`declares none on a field-group row either, a many-to-many included (${dialect})`, () => {
      const unique = (
        buildDesiredTableFromComponentFields(
          "comp_card",
          [
            ...fields,
            {
              name: "links",
              type: "relationship",
              relationTo: "posts",
              unique: true,
              options: { relationType: "manyToMany" },
            },
          ] as never,
          dialect,
          { builtBy: "codeFirst" }
        ).indexes ?? []
      )
        .filter(index => index.unique)
        .map(index => index.name)
        .sort();
      expect(unique).toEqual(["uq_comp_card_owner", "uq_comp_card_pick"]);
    });
  }
});
