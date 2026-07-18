/**
 * `classifyFieldKind()` must return "skip" for a many-to-many relationship
 * field so `getColumnDescriptor()` returns null and no phantom parent column
 * is emitted. A many-to-many relationship's links live entirely in a
 * dedicated junction table (see dynamic-collection-schema-service's
 * `generateJunctionTable`); a parent-row column for it would describe a
 * column the physical schema never has, so the Drizzle runtime table object
 * would disagree with the database on every m2m collection.
 *
 * Contrasted here against a single-target relationship (still gets an
 * `fkSingle` column) and a hasMany relationship (gets a `json` column) so the
 * "skip only for manyToMany" boundary is pinned down, not just its positive
 * case.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { getColumnDescriptor } from "../field-column-descriptor";

describe("getColumnDescriptor — many-to-many relationship fields", () => {
  it("returns null (no parent column) for a manyToMany relationship field", () => {
    const field = {
      name: "tags",
      type: "relationship",
      options: { relationType: "manyToMany", target: "tags" },
    } as unknown as FieldDefinition;

    expect(getColumnDescriptor(field, "postgresql")).toBeNull();
    expect(getColumnDescriptor(field, "mysql")).toBeNull();
    expect(getColumnDescriptor(field, "sqlite")).toBeNull();
  });

  it("still emits an fkSingle column for a single-target (manyToOne) relationship", () => {
    const field = {
      name: "author",
      type: "relationship",
      options: { relationType: "manyToOne", target: "users" },
    } as unknown as FieldDefinition;

    const desc = getColumnDescriptor(field, "postgresql");
    expect(desc).not.toBeNull();
    expect(desc?.kind).toBe("fkSingle");
    expect(desc?.name).toBe("author");
  });

  it("still emits a json column for a hasMany relationship (array of FK ids, not a junction table)", () => {
    const field = {
      name: "collaborators",
      type: "relationship",
      hasMany: true,
      options: { target: "users" },
    } as unknown as FieldDefinition;

    const desc = getColumnDescriptor(field, "postgresql");
    expect(desc).not.toBeNull();
    expect(desc?.kind).toBe("json");
  });

  it("emits a json column for a polymorphic array-target relationship (relationTo as array)", () => {
    const field = {
      name: "linkable",
      type: "relationship",
      relationTo: ["posts", "pages"],
    } as unknown as FieldDefinition;

    const desc = getColumnDescriptor(field, "postgresql");
    expect(desc).not.toBeNull();
    expect(desc?.kind).toBe("json");
  });
});
