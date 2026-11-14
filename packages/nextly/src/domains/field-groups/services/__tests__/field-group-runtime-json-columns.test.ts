/**
 * Every field the column descriptor stores as JSON is bound as JSON by a field group's runtime
 * table, on every dialect.
 *
 * The field group's CREATE takes each column's type from the descriptor, so a `hasMany` number and
 * a chips field get a JSON column. The runtime Drizzle table is what reads and writes that column,
 * and it is also what drizzle-kit is handed when a schema change takes the kit route. A runtime
 * column of another storage class describes a column the table does not have: a write of the list
 * is refused, and a kit rebuild converts the JSON list back to a scalar.
 */
import { getColumns, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { FieldConfig } from "../../../../collections/fields/types";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { STORAGE_FORMAT } from "../../../../schemas/storage-format";
import {
  getComponentRowColumnDescriptor,
  type SupportedDialect,
} from "../../../schema/services/field-column-descriptor";
import { FieldGroupSchemaService } from "../field-group-schema-service";

/** Fields the descriptor stores as JSON, each named for the column it makes. */
const JSON_FIELDS = [
  { name: "scores", type: "number", hasMany: true },
  { name: "prices", type: "number", hasMany: true, dbType: "decimal" },
  { name: "labels", type: "chips" },
  { name: "payload", type: "json" },
  { name: "links", type: "relationship", relationTo: "posts", hasMany: true },
];

/** The Drizzle column type each dialect's JSON column is bound as. */
const JSON_COLUMN: Record<SupportedDialect, string> = {
  postgresql: "PgJsonb",
  mysql: "MySqlJson",
  sqlite: "SQLiteText",
};

describe.each(["postgresql", "mysql", "sqlite"] as const)("%s", dialect => {
  const table = new FieldGroupSchemaService(dialect).generateRuntimeSchema(
    "comp_lists",
    JSON_FIELDS as unknown as FieldConfig[],
    { typeColumn: STORAGE_FORMAT.columns.type }
  ) as Table;
  const columns = Object.values(getColumns(table));

  it.each(JSON_FIELDS.map(field => [field.name, field] as const))(
    "binds %s as the JSON column the CREATE makes",
    (name, field) => {
      // The premise, checked rather than assumed: the descriptor stores this field as JSON.
      expect(
        getComponentRowColumnDescriptor(
          field as unknown as FieldDefinition,
          dialect,
          "fieldGroup"
        )?.kind
      ).toBe("json");
      expect(columns.find(c => c.name === name)?.columnType).toBe(
        JSON_COLUMN[dialect]
      );
    }
  );
});
