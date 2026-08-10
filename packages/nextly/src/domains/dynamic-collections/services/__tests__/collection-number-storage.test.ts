// What column a number field reaches, for each of the three ways one can ask.
//
// A number is not one column. `dbType: "decimal"` asks for EXACT fixed point, which is what a price
// needs: a whole-number column silently discards the fraction entirely. `options.format === "float"`
// asks for an ordinary fractional number. Silence asks for whole numbers.
//
// Pinned per dialect because the storage differs per dialect, and pinned on BOTH the create path and
// the ADD COLUMN path because those are separate code: a field can reach the right column when its
// table is created and the wrong one when it is added to a table that already exists, and the column
// that results is the one the runtime has to read through.

import { describe, expect, it } from "vitest";

import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionSchemaService } from "../dynamic-collection-schema-service";

type Dialect = "postgresql" | "mysql" | "sqlite";

const TABLE = "dc_number_storage";

function createdColumn(dialect: Dialect, field: FieldDefinition): string {
  const sql = new DynamicCollectionSchemaService(
    undefined,
    dialect
  ).generateMigrationSQL(TABLE, [field], {});
  const line = sql
    .split("\n")
    .find(
      l => l.includes(`"${field.name}"`) || l.includes(`\`${field.name}\``)
    );
  return (line ?? "").trim();
}

function addedColumn(dialect: Dialect, field: FieldDefinition): string {
  const sql = new DynamicCollectionSchemaService(
    undefined,
    dialect
  ).generateAlterTableMigration(TABLE, [], [field], { tableHasRows: false });
  const line = sql.split("\n").find(l => /ADD COLUMN/i.test(l));
  return (line ?? "").trim();
}

const money = (name: string): FieldDefinition =>
  ({
    name,
    type: "number",
    dbType: "decimal",
    precision: 12,
    scale: 4,
  }) as unknown as FieldDefinition;

describe("a number field's storage", () => {
  // The defect this pins: `dbType` was never read on this path, so a price column was created as a
  // whole number and every fractional amount written to it was lost.
  it.each([
    ["postgresql", "numeric(12, 4)"],
    ["mysql", "decimal(12,4)"],
    ["sqlite", "numeric"],
  ] as const)(
    "gives an exact-decimal field an exact column on %s",
    (dialect, expected) => {
      expect(createdColumn(dialect, money("price"))).toContain(expected);
    }
  );

  it.each([
    ["postgresql", "numeric(12, 4)"],
    ["mysql", "decimal(12,4)"],
    ["sqlite", "numeric"],
  ] as const)(
    "gives it the same column when it is ADDED to an existing table on %s",
    (dialect, expected) => {
      expect(addedColumn(dialect, money("price"))).toContain(expected);
    }
  );

  // Stated so the exact cases above cannot be satisfied by making every number a decimal.
  it("still gives a plain number a whole-number column", () => {
    const field = {
      name: "views",
      type: "number",
    } as unknown as FieldDefinition;

    expect(createdColumn("postgresql", field)).toContain("integer");
    expect(createdColumn("postgresql", field)).not.toContain("numeric");
  });

  // `precision` and `scale` are what let the column hold the values the field promises, so a default
  // that silently ignored them would pass every assertion above that names no dimensions.
  it("defaults an exact-decimal field that states no dimensions", () => {
    const field = {
      name: "amount",
      type: "number",
      dbType: "decimal",
    } as unknown as FieldDefinition;

    expect(createdColumn("postgresql", field)).toContain("numeric(10, 2)");
  });
});

describe("an edit that changes a number's storage", () => {
  const svc = (d: Dialect = "postgresql") =>
    new DynamicCollectionSchemaService(undefined, d);

  const plain = { name: "price", type: "number" } as unknown as FieldDefinition;

  // The defect: the modification check listed the properties it compared, and none of the four that
  // decide a number's storage were on that list. A field switched to exact decimal therefore
  // produced no ALTER, so the registry described a decimal over an integer column.
  it("notices a field switched to an exact decimal", () => {
    expect(svc().isFieldModified(plain, money("price"))).toBe(true);
  });

  it("notices a precision change on a field that is already decimal", () => {
    const before = {
      name: "price",
      type: "number",
      dbType: "decimal",
      precision: 10,
      scale: 2,
    } as unknown as FieldDefinition;

    expect(svc().isFieldModified(before, money("price"))).toBe(true);
  });

  // Stated so the cases above cannot be satisfied by reporting every field as modified, which would
  // rewrite columns on every save.
  it("still reports an unchanged field as unchanged", () => {
    expect(svc().isFieldModified(plain, { ...plain })).toBe(false);
    expect(svc().isFieldModified(money("price"), money("price"))).toBe(false);
  });
});

describe("decimal dimensions that cannot safely become SQL", () => {
  // These arrive from a request payload on the Builder path, which validates names and plugin
  // options but not these. Unchecked, the value is interpolated into the type verbatim.
  const generate = (field: FieldDefinition): string =>
    new DynamicCollectionSchemaService(
      undefined,
      "postgresql"
    ).generateMigrationSQL(TABLE, [field], {});

  it.each([
    ["a non-integer precision", { precision: 2.5, scale: 1 }],
    ["a scale larger than the precision", { precision: 2, scale: 8 }],
    ["a precision out of range", { precision: 0, scale: 0 }],
  ])("refuses %s", (_label, dims) => {
    const field = {
      name: "price",
      type: "number",
      dbType: "decimal",
      ...dims,
    } as unknown as FieldDefinition;

    expect(() => generate(field)).toThrow();
  });

  it("accepts dimensions that are usable", () => {
    expect(() => generate(money("price"))).not.toThrow();
  });
});
