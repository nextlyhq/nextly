/**
 * Which relationship columns are JSON, and which of those hold a list of references, asked once for
 * every consumer.
 *
 * A collection or Single row stores a relation as JSON when it is `hasMany` (a list) or names
 * several targets (one `{ relationTo, value }` object, or a list of them); its many-to-many has no
 * column there, because the links live in a junction table. A component row has no junction table,
 * so its many-to-many keeps a list on the row too. The creating SQL, the runtime table, the row
 * serializer and the desired schema ask whether a column is JSON; converting an older scalar column
 * asks whether it holds a list, which a single polymorphic reference does not.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import {
  componentRelationshipHoldsReferenceList,
  componentRelationshipStoresJson,
  getComponentRowColumnDescriptor,
  relationshipStoresJson,
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

describe("relationshipStoresJson, for a collection or Single row", () => {
  it.each([
    ["a hasMany relationship", hasMany],
    ["a polymorphic relationship", polymorphic],
    ["a hasMany upload", hasManyUpload],
  ])("is true for %s", (_label, field) => {
    expect(relationshipStoresJson(field)).toBe(true);
  });

  it.each([
    ["a single relationship", single],
    ["a Builder single relationship", builderSingle],
    // Its links live in a junction table, so the row holds nothing for it.
    ["a many-to-many", manyToMany],
    ["a text field", { name: "title", type: "text", hasMany: true }],
  ])("is false for %s", (_label, field) => {
    expect(relationshipStoresJson(field)).toBe(false);
  });
});

describe("componentRelationshipStoresJson, for a component row", () => {
  it.each([
    ["a many-to-many", manyToMany],
    ["a hasMany relationship", hasMany],
    ["a polymorphic relationship", polymorphic],
  ])("is true for %s", (_label, field) => {
    expect(componentRelationshipStoresJson(field)).toBe(true);
  });

  it.each([
    ["a single relationship", single],
    ["a Builder single relationship", builderSingle],
  ])("is false for %s", (_label, field) => {
    expect(componentRelationshipStoresJson(field)).toBe(false);
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

describe("componentRelationshipHoldsReferenceList, for converting an older component column", () => {
  it.each([
    ["a many-to-many", manyToMany],
    ["a hasMany relationship", hasMany],
    ["a hasMany polymorphic relationship", { ...polymorphic, hasMany: true }],
  ])("is true for %s", (_label, field) => {
    expect(componentRelationshipHoldsReferenceList(field)).toBe(true);
  });

  it.each([
    // One `{ relationTo, value }` object: JSON, but not a list.
    ["a single polymorphic relationship", polymorphic],
    ["a single relationship", single],
    ["a Builder single relationship", builderSingle],
  ])("is false for %s", (_label, field) => {
    expect(componentRelationshipHoldsReferenceList(field)).toBe(false);
  });
});
