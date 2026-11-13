/**
 * Which relationships carry a foreign key, and the table it points at.
 *
 * The admin writes a relationship's target as `relationTo`; programmatic callers write
 * `options.target`. A Schema Builder collection's own keys read both, keyed to the table the
 * registry holds for the target and to nothing it does not hold (Users, a Single, an unknown
 * slug), while every other reader keys `options.target` alone, as it always has.
 */
import { describe, expect, it } from "vitest";

import { builderKeyTables } from "../../dynamic-collections/services/collection-tables";

import {
  relationshipKeyTarget,
  relationshipTargetSlug,
  type RelationshipKeyField,
} from "./relationship-key-target";

const relationship = (extra: RelationshipKeyField): RelationshipKeyField => ({
  type: "relationship",
  ...extra,
});

// The registry's tables by slug: a code-first collection with a `dbName`, a dashed slug, and a
// collection named as it was created.
const entries = [
  ["posts", "dc_posts"],
  ["authors", "writers"],
  ["blog-posts", "dc_blog_posts"],
] as const;
const builder = builderKeyTables(entries);
const plain = new Map(entries);

describe("relationshipKeyTarget, for a Builder collection's own keys", () => {
  it("keys a relationTo relationship to the table its target lives in", () => {
    expect(
      relationshipKeyTarget(relationship({ relationTo: "authors" }), builder)
    ).toEqual({ slug: "authors", table: "writers" });
  });

  it("keys a self-reference", () => {
    expect(
      relationshipKeyTarget(relationship({ relationTo: "posts" }), builder)
    ).toEqual({ slug: "posts", table: "dc_posts" });
  });

  it("keys a relationship to Users to the core users table", () => {
    expect(
      relationshipKeyTarget(relationship({ relationTo: "users" }), builder)
    ).toEqual({ slug: "users", table: "users" });
  });

  it("gives a relationTo slug the registry does not hold no key", () => {
    // A Single or a slug that names nothing: a guessed table would fail the apply.
    for (const slug of ["site-settings", "nothing"]) {
      expect(
        relationshipKeyTarget(relationship({ relationTo: slug }), builder)
      ).toBeNull();
    }
  });

  it("reads relationTo over options.target, as reads do", () => {
    expect(
      relationshipKeyTarget(
        relationship({ relationTo: "authors", options: { target: "posts" } }),
        builder
      )
    ).toEqual({ slug: "authors", table: "writers" });
    expect(
      relationshipKeyTarget(
        relationship({ relationTo: "nothing", options: { target: "posts" } }),
        builder
      )
    ).toBeNull();
  });

  it("keeps the spelled dc_ table for an options.target the registry does not hold", () => {
    expect(
      relationshipKeyTarget(
        relationship({ options: { target: "tags" } }),
        builder
      )
    ).toEqual({ slug: "tags", table: "dc_tags" });
  });

  it("keys each single-column relation type, many-to-one when unstated", () => {
    for (const relationType of [
      "oneToOne",
      "manyToOne",
      "oneToMany",
      undefined,
    ]) {
      expect(
        relationshipKeyTarget(
          relationship({ relationTo: "authors", options: { relationType } }),
          builder
        )
      ).toEqual({ slug: "authors", table: "writers" });
    }
  });
});

describe("relationshipKeyTarget, for every other reader", () => {
  it("keys no relationTo relationship, so a Single or a code-first table is untouched", () => {
    expect(
      relationshipKeyTarget(relationship({ relationTo: "authors" }), plain)
    ).toBeNull();
    expect(
      relationshipKeyTarget(relationship({ relationTo: "authors" }))
    ).toBeNull();
  });

  it("keys options.target to the registry's table, honouring a dbName, else its spelled table", () => {
    expect(
      relationshipKeyTarget(
        relationship({ options: { target: "authors" } }),
        plain
      )
    ).toEqual({ slug: "authors", table: "writers" });
    expect(
      relationshipKeyTarget(relationship({ options: { target: "blog-posts" } }))
    ).toEqual({ slug: "blog-posts", table: "dc_blog_posts" });
  });

  it("keys options.target when relationTo names the same collection", () => {
    expect(
      relationshipKeyTarget(
        relationship({ relationTo: "tags", options: { target: "tags" } })
      )
    ).toEqual({ slug: "tags", table: "dc_tags" });
  });

  it("gives no key to options.target when relationTo, which reads follow, names another", () => {
    expect(
      relationshipKeyTarget(
        relationship({ relationTo: "posts", options: { target: "tags" } })
      )
    ).toBeNull();
  });
});

describe("relationshipKeyTarget, for fields that hold no single id", () => {
  it("gives no key to a relationship stored as JSON", () => {
    for (const field of [
      relationship({ relationTo: "authors", hasMany: true }),
      relationship({ options: { target: "authors" }, hasMany: true }),
      relationship({ relationTo: ["authors", "posts"] }),
      relationship({ relationTo: ["authors"] }),
    ]) {
      expect(relationshipKeyTarget(field, builder)).toBeNull();
    }
  });

  it("gives no key to a many-to-many, which lives in a junction table", () => {
    expect(
      relationshipKeyTarget(
        relationship({
          relationTo: "authors",
          options: { target: "authors", relationType: "manyToMany" },
        }),
        builder
      )
    ).toBeNull();
  });

  it("gives no key to an upload, a non-relationship, a virtual one or one naming no target", () => {
    for (const field of [
      { type: "upload", relationTo: "media" },
      { type: "text" },
      relationship({ relationTo: "authors", virtual: true }),
      relationship({}),
    ]) {
      expect(relationshipKeyTarget(field, builder)).toBeNull();
    }
  });
});

describe("relationshipTargetSlug", () => {
  it("reads relationTo first, then options.target, and none for a list", () => {
    expect(
      relationshipTargetSlug({ relationTo: "a", options: { target: "b" } })
    ).toBe("a");
    expect(relationshipTargetSlug({ options: { target: "b" } })).toBe("b");
    expect(
      relationshipTargetSlug({ relationTo: ["a"], options: { target: "b" } })
    ).toBeNull();
    expect(relationshipTargetSlug({})).toBeNull();
  });
});
