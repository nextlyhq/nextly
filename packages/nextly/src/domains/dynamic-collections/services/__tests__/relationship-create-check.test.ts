/**
 * The check a relationship meets when a collection is created or its fields
 * are replaced: it must name a collection to link to, read as the editor
 * writes it today (`relationTo`, one collection or several) or as the earlier
 * Builder stored it (`options.target`, with its cardinality beside it in
 * `options.relationType`). A cardinality given either way must be one the
 * schema knows, and a many-to-many cannot be required.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionValidationService } from "../dynamic-collection-validation-service";

/**
 * The check on a relationship field named `author`, given as a request sends
 * it: any shape at all, an unknown cardinality included, since the check is
 * what judges it.
 */
const check = (field: Record<string, unknown>) => () =>
  new DynamicCollectionValidationService().validateRelationshipField({
    name: "author",
    type: "relationship",
    ...field,
  } as FieldDefinition);

describe("a relationship's create check", () => {
  it("takes the target as the editor writes it, with no options", () => {
    expect(check({ relationTo: "authors" })).not.toThrow();
  });

  it("takes a link to several collections as the editor writes it", () => {
    expect(check({ relationTo: ["authors", "editors"] })).not.toThrow();
  });

  it("takes the earlier shape, its target and cardinality in options", () => {
    expect(
      check({ options: { target: "authors", relationType: "manyToOne" } })
    ).not.toThrow();
  });

  it("refuses a relationship naming no collection, either way", () => {
    expect(check({})).toThrow(
      'Relationship field "author" must specify a target collection'
    );
    expect(check({ relationTo: "" })).toThrow(/must specify a target/);
    expect(check({ relationTo: [] })).toThrow(/must specify a target/);
  });

  it("refuses the earlier shape without its cardinality", () => {
    expect(check({ options: { target: "authors" } })).toThrow(
      /must specify a relationType/
    );
  });

  it("refuses an unknown cardinality, whichever way the target is given", () => {
    expect(
      check({ relationTo: "authors", options: { relationType: "lots" } })
    ).toThrow(/Invalid relationType "lots"/);
  });

  it("refuses a required many-to-many, whichever way the target is given", () => {
    expect(
      check({
        relationTo: "authors",
        required: true,
        options: { relationType: "manyToMany" },
      })
    ).toThrow(/cannot be marked as required/);
  });
});
