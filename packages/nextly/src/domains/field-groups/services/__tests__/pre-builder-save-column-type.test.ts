/**
 * The field group's creator's earlier column types, as recorded for recognising the tables it built.
 *
 * Pinned literally on purpose: this is a record of what that creator wrote before it read the column
 * descriptor, and the field-group reconcile and the column repair report recognise existing tables
 * by it. A change here stops recognising tables that exist, so it has to be deliberate.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { DataFieldConfig } from "../../../../collections/fields/types";
import {
  clearFieldTypes,
  registerFieldType,
} from "../../../schema/field-types/field-type-registry";
import { preBuilderSaveColumnType } from "../pre-builder-save-column-type";

afterEach(() => {
  clearFieldTypes();
});

const asField = (field: Record<string, unknown>): DataFieldConfig =>
  ({ name: "value", ...field }) as unknown as DataFieldConfig;

/** Each field with the type the creator gave it on PostgreSQL, MySQL and SQLite. */
const EARLIER: Array<
  [
    string,
    Record<string, unknown>,
    [string | null, string | null, string | null],
  ]
> = [
  ["a textarea", { type: "textarea" }, ["TEXT", "TEXT", "TEXT"]],
  ["an email", { type: "email" }, ["VARCHAR(255)", "VARCHAR(255)", "TEXT"]],
  [
    "a password",
    { type: "password" },
    ["VARCHAR(255)", "VARCHAR(255)", "TEXT"],
  ],
  ["a radio", { type: "radio" }, ["VARCHAR(255)", "VARCHAR(255)", "TEXT"]],
  ["a number", { type: "number" }, ["INTEGER", "INT", "INTEGER"]],
  [
    "a float number",
    { type: "number", options: { format: "float" } },
    ["DOUBLE PRECISION", "DOUBLE", "REAL"],
  ],
  [
    "a decimal number",
    { type: "number", dbType: "decimal", precision: 12, scale: 4 },
    ["NUMERIC(12, 4)", "DECIMAL(12, 4)", "NUMERIC"],
  ],
  [
    "a decimal number of the default size",
    { type: "number", dbType: "decimal" },
    ["NUMERIC(10, 2)", "DECIMAL(10, 2)", "NUMERIC"],
  ],
  [
    "a hasMany number",
    { type: "number", hasMany: true },
    ["INTEGER", "INT", "INTEGER"],
  ],
  ["a checkbox", { type: "checkbox" }, ["BOOLEAN", "BOOLEAN", "INTEGER"]],
  ["a date", { type: "date" }, ["TIMESTAMP", "DATETIME", "INTEGER"]],
  ["a select", { type: "select" }, ["VARCHAR(255)", "VARCHAR(255)", "TEXT"]],
  [
    "a multi-select",
    { type: "select", hasMany: true },
    ["JSONB", "JSON", "TEXT"],
  ],
  [
    "a single reference",
    { type: "relationship", relationTo: "posts" },
    ["UUID", "VARCHAR(36)", "TEXT"],
  ],
  [
    "a list of references",
    { type: "upload", relationTo: "media", hasMany: true },
    ["JSONB", "JSON", "TEXT"],
  ],
  ["a repeater", { type: "repeater", fields: [] }, ["JSONB", "JSON", "TEXT"]],
  ["a json field", { type: "json" }, ["JSONB", "JSON", "TEXT"]],
  // Already the descriptor's: an unbounded text field and an icon.
  ["a text field", { type: "text" }, ["text", "text", "text"]],
  ["an icon", { type: "icon" }, ["text", "varchar(255)", "text"]],
  // No column at all.
  ["a chips field", { type: "chips" }, [null, null, null]],
];

describe("the field-group creator's earlier column types", () => {
  it.each(EARLIER)("%s", (_label, field, [postgresql, mysql, sqlite]) => {
    expect(preBuilderSaveColumnType(asField(field), "postgresql")).toBe(
      postgresql
    );
    expect(preBuilderSaveColumnType(asField(field), "mysql")).toBe(mysql);
    expect(preBuilderSaveColumnType(asField(field), "sqlite")).toBe(sqlite);
  });

  it("gives an unnamed text field no column", () => {
    expect(
      preBuilderSaveColumnType(
        { type: "text" } as unknown as DataFieldConfig,
        "postgresql"
      )
    ).toBeNull();
  });

  it("maps a contributed type as its storage primitive, ignoring its own options", () => {
    registerFieldType({
      type: "metric",
      storage: "number",
      component: "@acme/metric/admin#Metric",
      surfaces: ["entries"],
    });
    // `dbType` is the plugin type's own option here, which that creator did not read.
    expect(
      preBuilderSaveColumnType(
        asField({ type: "metric", dbType: "decimal" }),
        "postgresql"
      )
    ).toBe("INTEGER");
  });
});
