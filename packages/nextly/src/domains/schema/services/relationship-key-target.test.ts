import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { relationshipKeyTarget } from "./relationship-key-target";

/** A relationship field, as the Builder or a REST save records one. */
function relationship(extra: Partial<FieldDefinition>): FieldDefinition {
  return { name: "author", type: "relationship", ...extra } as FieldDefinition;
}

// The registry's tables by slug: a code-first collection with a `dbName`, a
// dashed slug, and a collection named as it is created.
const tables: Record<string, string> = {
  posts: "dc_posts",
  authors: "writers",
  "blog-posts": "dc_blog_posts",
};
const tableFor = (slug: string) => tables[slug] ?? null;

describe("relationshipKeyTarget", () => {
  it("keys a relationTo relationship to the table its target lives in", () => {
    expect(
      relationshipKeyTarget(relationship({ relationTo: "authors" }), tableFor)
    ).toEqual({ slug: "authors", table: "writers" });
  });

  it("keys an options.target relationship to its registry table, honouring a dbName", () => {
    expect(
      relationshipKeyTarget(
        relationship({ options: { target: "authors" } }),
        tableFor
      )
    ).toEqual({ slug: "authors", table: "writers" });
  });

  it("keys a dashed target to the table its underscores name", () => {
    expect(
      relationshipKeyTarget(
        relationship({ options: { target: "blog-posts" } }),
        tableFor
      )
    ).toEqual({ slug: "blog-posts", table: "dc_blog_posts" });
  });

  it("keeps the dc_ table for an options.target the registry does not know", () => {
    expect(
      relationshipKeyTarget(relationship({ options: { target: "tags" } }))
    ).toEqual({ slug: "tags", table: "dc_tags" });
    expect(
      relationshipKeyTarget(
        relationship({ options: { target: "tags" } }),
        tableFor
      )
    ).toEqual({ slug: "tags", table: "dc_tags" });
  });

  it("gives a relationTo slug the registry does not know no key", () => {
    // Users, a Single or a slug that names nothing: a guessed table would fail the apply.
    expect(
      relationshipKeyTarget(relationship({ relationTo: "users" }), tableFor)
    ).toBeNull();
    expect(
      relationshipKeyTarget(relationship({ relationTo: "authors" }))
    ).toBeNull();
  });

  it("reads relationTo over options.target, as reads do", () => {
    expect(
      relationshipKeyTarget(
        relationship({ relationTo: "authors", options: { target: "posts" } }),
        tableFor
      )
    ).toEqual({ slug: "authors", table: "writers" });
  });

  it("keeps today's key when relationTo and options.target agree and the registry is not asked", () => {
    expect(
      relationshipKeyTarget(
        relationship({ relationTo: "tags", options: { target: "tags" } })
      )
    ).toEqual({ slug: "tags", table: "dc_tags" });
  });

  it("gives a differing relationTo no guessed key when the registry does not know it", () => {
    expect(
      relationshipKeyTarget(
        relationship({ relationTo: "users", options: { target: "posts" } }),
        tableFor
      )
    ).toBeNull();
  });

  it("keys a self-reference", () => {
    expect(
      relationshipKeyTarget(relationship({ relationTo: "posts" }), tableFor)
    ).toEqual({ slug: "posts", table: "dc_posts" });
  });

  it("gives no key to a relationship stored as JSON", () => {
    for (const field of [
      relationship({ relationTo: "authors", hasMany: true }),
      relationship({ options: { target: "authors" }, hasMany: true }),
      relationship({ relationTo: ["authors", "posts"] }),
      relationship({ relationTo: ["authors"] }),
    ]) {
      expect(relationshipKeyTarget(field, tableFor)).toBeNull();
    }
  });

  it("gives no key to a many-to-many, which lives in a junction table", () => {
    expect(
      relationshipKeyTarget(
        relationship({
          options: { target: "authors", relationType: "manyToMany" },
        }),
        tableFor
      )
    ).toBeNull();
  });

  it("keys each single-column relation type", () => {
    for (const relationType of [
      "oneToOne",
      "manyToOne",
      "oneToMany",
    ] as const) {
      expect(
        relationshipKeyTarget(
          relationship({ options: { target: "authors", relationType } }),
          tableFor
        )
      ).toEqual({ slug: "authors", table: "writers" });
    }
  });

  it("gives no key to an upload, a non-relationship, or a relationship naming no target", () => {
    expect(
      relationshipKeyTarget(
        {
          name: "cover",
          type: "upload",
          relationTo: "media",
        } as FieldDefinition,
        tableFor
      )
    ).toBeNull();
    expect(
      relationshipKeyTarget(
        { name: "title", type: "text" } as FieldDefinition,
        tableFor
      )
    ).toBeNull();
    expect(relationshipKeyTarget(relationship({}), tableFor)).toBeNull();
  });

  it("gives no key to a virtual relationship, which has no column", () => {
    expect(
      relationshipKeyTarget(
        // The root-level flag every field type accepts, which the definition type does not name.
        {
          ...relationship({ relationTo: "authors" }),
          virtual: true,
        } as FieldDefinition,
        tableFor
      )
    ).toBeNull();
  });
});
