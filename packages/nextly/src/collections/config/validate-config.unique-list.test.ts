/**
 * `unique` on a relation holding a list of references is refused where the config is defined, on
 * every dialect: "unique" there would mean no two entries hold the identical list, which is rarely
 * what is meant, and a unique btree over a long list refuses the save on PostgreSQL. A relation to
 * one entry, polymorphic or not, stays allowed to be unique.
 */
import { describe, expect, it } from "vitest";

import { text } from "../fields/helpers";
import type { CollectionConfig } from "./define-collection";
import { validateCollectionConfig } from "./validate-config";

function errorsFor(field: Record<string, unknown>) {
  const config = {
    slug: "posts",
    fields: [text({ name: "title" }), field],
  } as unknown as CollectionConfig;
  return validateCollectionConfig(config, ["posts", "tags", "media", "a", "b"])
    .errors;
}

describe("validateCollectionConfig: unique on a relation holding a list", () => {
  it.each([
    [
      "a hasMany relationship",
      { type: "relationship", relationTo: "tags", hasMany: true },
    ],
    [
      "a hasMany upload",
      { type: "upload", relationTo: "media", hasMany: true },
    ],
    [
      "a list to several collections",
      { type: "relationship", relationTo: ["a", "b"], hasMany: true },
    ],
    [
      "a many-to-many",
      {
        type: "relationship",
        relationTo: "tags",
        options: { relationType: "manyToMany" },
      },
    ],
  ])(
    "refuses %s marked unique, naming the field and the fix",
    (_label, shape) => {
      expect(
        errorsFor({ name: "links", ...shape, unique: true })
      ).toContainEqual(
        expect.objectContaining({
          path: "fields[1].unique",
          code: "UNIQUE_NOT_ON_LIST",
          // The same words the Schema Builder refuses it with.
          message: expect.stringContaining(
            'Turn Unique off on "links", or make it a single link.'
          ),
        })
      );
    }
  );

  it.each([
    ["a relation to one entry", { type: "relationship", relationTo: "tags" }],
    [
      "one reference to one of several collections",
      { type: "relationship", relationTo: ["a", "b"] },
    ],
    ["an upload of one file", { type: "upload", relationTo: "media" }],
  ])("allows %s to be unique", (_label, shape) => {
    expect(
      errorsFor({ name: "links", ...shape, unique: true }).map(
        error => error.code
      )
    ).not.toContain("UNIQUE_NOT_ON_LIST");
  });

  it("allows a list that is not marked unique", () => {
    expect(
      errorsFor({
        name: "links",
        type: "relationship",
        relationTo: "tags",
        hasMany: true,
      }).map(error => error.code)
    ).not.toContain("UNIQUE_NOT_ON_LIST");
  });
});
