/**
 * A component's many-to-many column is text on PostgreSQL, on every route that creates the table.
 *
 * The creating SQL, the drizzle-kit runtime table and the desired schema must name the same type. A
 * scalar uuid cannot hold a multi-value Builder relation, which is stored as an array; text stores
 * that value without rejecting it.
 */
import { getColumns, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import { FieldGroupSchemaService } from "../field-group-schema-service";

const MANY_TO_MANY = [
  {
    name: "tags",
    type: "relationship",
    options: { target: "tags", relationType: "manyToMany" },
  },
] as unknown as FieldConfig[];

describe("a component many-to-many column type on PostgreSQL", () => {
  it("is text in the runtime table that drizzle-kit creates", () => {
    const table = new FieldGroupSchemaService(
      "postgresql"
    ).generateRuntimeSchema("comp_hero", MANY_TO_MANY, {
      typeColumn: STORAGE_FORMAT.columns.type,
    }) as Table;
    const tags = Object.values(getColumns(table)).find(c => c.name === "tags");
    expect(tags?.columnType).toBe("PgText");
  });

  it("is text in the creating SQL, not uuid", () => {
    const sql = new FieldGroupSchemaService("postgresql").generateMigrationSQL(
      "comp_hero",
      MANY_TO_MANY
    );
    const tagsLine =
      sql.split("\n").find(line => /"?tags"?\s/.test(line)) ?? "";
    expect(tagsLine).toMatch(/\bTEXT\b/);
    expect(tagsLine).not.toMatch(/\bUUID\b/);
  });
});
