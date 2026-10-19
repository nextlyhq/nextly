/**
 * Which relationship columns hold a list of references, asked once for every consumer.
 *
 * A collection or Single row keeps a list when the field is `hasMany` or names several targets; its
 * many-to-many has no column there, because the links live in a junction table. A component row has
 * no junction table, so its many-to-many keeps the list on the row too. The creating SQL, the
 * runtime table, the row serializer and the desired schema all ask these two questions, so a
 * relation is stored and read as the same shape on every route.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import {
  componentRelationshipStoresList,
  getComponentRowColumnDescriptor,
  relationshipStoresList,
} from "../field-column-descriptor";

const single = { name: "author", type: "relationship", relationTo: "users" };
const hasMany = { ...single, hasMany: true };
const polymorphic = { ...single, relationTo: ["users", "posts"] };
const builderSingle = {
  name: "author",
  type: "relationship",
  options: { target: "users", relationType: "manyToOne" },
};
const manyToMany = {
  name: "tags",
  type: "relationship",
  options: { target: "tags", relationType: "manyToMany" },
};
const hasManyUpload = { name: "gallery", type: "upload", hasMany: true };

describe("relationshipStoresList, for a collection or Single row", () => {
  it.each([
    ["a hasMany relationship", hasMany],
    ["a polymorphic relationship", polymorphic],
    ["a hasMany upload", hasManyUpload],
  ])("is true for %s", (_label, field) => {
    expect(relationshipStoresList(field)).toBe(true);
  });

  it.each([
    ["a single relationship", single],
    ["a Builder single relationship", builderSingle],
    // Its links live in a junction table, so the row holds nothing for it.
    ["a many-to-many", manyToMany],
    ["a text field", { name: "title", type: "text", hasMany: true }],
  ])("is false for %s", (_label, field) => {
    expect(relationshipStoresList(field)).toBe(false);
  });
});

describe("componentRelationshipStoresList, for a component row", () => {
  it.each([
    ["a many-to-many", manyToMany],
    ["a hasMany relationship", hasMany],
    ["a polymorphic relationship", polymorphic],
  ])("is true for %s", (_label, field) => {
    expect(componentRelationshipStoresList(field)).toBe(true);
  });

  it.each([
    ["a single relationship", single],
    ["a Builder single relationship", builderSingle],
  ])("is false for %s", (_label, field) => {
    expect(componentRelationshipStoresList(field)).toBe(false);
  });
});

describe.each([
  ["postgresql", "jsonb"],
  ["mysql", "json"],
  ["sqlite", "text"],
] as const)(
  "a component many-to-many's column on %s",
  (dialect, dialectType) => {
    it(`is the JSON list column (${dialectType})`, () => {
      const descriptor = getComponentRowColumnDescriptor(
        manyToMany as unknown as FieldDefinition,
        dialect,
        "fieldGroup"
      );
      expect(descriptor).toMatchObject({
        name: "tags",
        kind: "json",
        dialectType,
      });
    });

    it("is nullable when the field is required, as every relationship column is", () => {
      const descriptor = getComponentRowColumnDescriptor(
        { ...manyToMany, required: true } as unknown as FieldDefinition,
        dialect,
        "fieldGroup"
      );
      expect(descriptor?.nullable).toBe(true);
    });
  }
);
