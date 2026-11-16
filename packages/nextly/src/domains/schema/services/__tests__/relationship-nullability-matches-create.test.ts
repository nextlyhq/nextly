/**
 * A relationship's column is described as nullable exactly when the CREATE makes it so, on every
 * dialect: NOT NULL when the field is required, and accepting nulls when it is not.
 *
 * The column descriptor is what a push and `migrate:create` plan from, and the Builder's CREATE is
 * what the table is. Where the descriptor called a required relationship nullable while the CREATE
 * wrote NOT NULL, a push planned a relax nobody asked for on every such table, and making the
 * relationship required planned nothing. So the two are compared here, for a relationship naming
 * one collection in a column of its own, required and not.
 */
import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { getColumnDescriptor } from "../field-column-descriptor";

type Dialect = "postgresql" | "mysql" | "sqlite";
const TABLE = "dc_rel_nullability";

const relationship = (required: boolean) =>
  ({
    name: "author",
    type: "relationship",
    relationTo: "authors",
    ...(required ? { required: true } : {}),
  }) as unknown as FieldDefinition;

/** Whether the CREATE makes `column` NOT NULL, read from its line; null where it has no such column. */
function createdNotNull(sql: string, column: string): boolean | null {
  const line = sql
    .split("\n")
    .map(text => text.trim())
    .find(text => new RegExp(`^[\`"]${column}[\`"]\\s`).test(text));
  if (line === undefined) return null;
  return /\bNOT NULL\b/i.test(line);
}

describe.each<Dialect>(["postgresql", "mysql", "sqlite"])(
  "a relationship's nullability, described and created — %s",
  dialect => {
    const service = new DynamicCollectionSchemaService(undefined, dialect);

    it.each([true, false])(
      "agrees with the CREATE when required is %s",
      required => {
        const field = relationship(required);
        const descriptor = getColumnDescriptor(field, dialect, "collection");
        // Positive control: the relationship has a column of its own on both sides.
        expect(descriptor).not.toBeNull();
        const created = createdNotNull(
          service.generateMigrationSQL(TABLE, [field], {}),
          descriptor!.name
        );
        expect(created).not.toBeNull();

        expect(descriptor!.nullable).toBe(!created);
        // And what `required` means: NOT NULL exactly when it is required.
        expect(created).toBe(required);
      }
    );
  }
);
