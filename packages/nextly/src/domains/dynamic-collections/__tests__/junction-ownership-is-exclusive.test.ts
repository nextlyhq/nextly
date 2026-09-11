/**
 * Two many-to-many fields may not store their links in one junction table.
 *
 * A link row carries the two collections' ids and nothing that says which
 * field made it, so two fields on one table would read each other's links,
 * and removing either field would take the other's table with it. Only an
 * author-named `junctionTable` can collide — the generated name carries the
 * field's own name — so that is what the save refuses.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { DynamicCollectionValidationService } from "../services/dynamic-collection-validation-service";

const relationship = (
  name: string,
  relationType: "manyToMany" | "manyToOne",
  junctionTable?: string
): FieldDefinition => ({
  name,
  type: "relationship",
  options: { relationType, target: "tags", junctionTable },
});

describe("junction ownership is exclusive", () => {
  const service = new DynamicCollectionValidationService();

  it("refuses two many-to-many fields that name the same junction table, naming both", () => {
    expect(() =>
      service.validateFieldNames([
        relationship("tags", "manyToMany", "post_tag_links"),
        { name: "summary", type: "text" },
        relationship("labels", "manyToMany", "post_tag_links"),
      ])
    ).toThrow(
      'Fields "tags" and "labels" both store their links in junction table "post_tag_links"'
    );
  });

  it("accepts two many-to-many fields with junction tables of their own", () => {
    expect(() =>
      service.validateFieldNames([
        relationship("tags", "manyToMany", "post_tag_links"),
        relationship("labels", "manyToMany", "post_label_links"),
      ])
    ).not.toThrow();
  });

  it("accepts two many-to-many fields that leave the name to the generator", () => {
    expect(() =>
      service.validateFieldNames([
        relationship("tags", "manyToMany"),
        relationship("labels", "manyToMany"),
      ])
    ).not.toThrow();
  });

  it("ignores a junctionTable on a field that has no junction", () => {
    // A many-to-one stores a column, not a table; the option is inert on it
    // and claims nothing.
    expect(() =>
      service.validateFieldNames([
        relationship("tags", "manyToMany", "post_tag_links"),
        relationship("author", "manyToOne", "post_tag_links"),
      ])
    ).not.toThrow();
  });
});
