import { describe, it, expect } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";

import {
  ComponentSchemaService,
  type SupportedDialect,
} from "./component-schema-service";

// Identifier quote per dialect, so assertions can tie a column type to its name.
const QUOTE: Record<SupportedDialect, string> = {
  postgresql: '"',
  mysql: "`",
  sqlite: '"',
};

// Builds a bare number field with whatever storage settings a case is pinning.
// The double cast is deliberate: `dbType`, `precision`, `scale` and
// `options.format` are declared on the individual number-field type rather than
// the FieldConfig union, so a plain cast cannot reach them. Spelling each
// variant as a fully-typed field would bury the one property under test.
const numberField = (extra: Record<string, unknown> = {}): FieldConfig =>
  ({ name: "value", type: "number", ...extra }) as unknown as FieldConfig;

function columnSql(dialect: SupportedDialect, field: FieldConfig): string {
  return new ComponentSchemaService(dialect).generateMigrationSQL(
    "comp_widget",
    [field]
  );
}

// Component number fields previously always became floating-point columns,
// unlike the same field in a collection. These cases pin each storage mode to
// the column type the runtime and the generated Drizzle schema build for it —
// a mismatch means the created table can never match the desired schema, so
// every later diff re-alters the same column.
describe("ComponentSchemaService number column typing", () => {
  // The default: whole numbers, so an integer column rather than a float that
  // would silently round-trip 1 as 1.0.
  it("types a default number field as an integer column (not real/double)", () => {
    const expected: Record<SupportedDialect, string> = {
      postgresql: "INTEGER",
      mysql: "INT",
      sqlite: "INTEGER",
    };
    for (const dialect of Object.keys(expected) as SupportedDialect[]) {
      const q = QUOTE[dialect];
      const sql = columnSql(dialect, numberField());
      expect(sql).toContain(`${q}value${q} ${expected[dialect]}`);
      expect(sql).not.toMatch(new RegExp(`${q}value${q}\\s+(REAL|DOUBLE)`));
    }
  });

  // dbType:"decimal" means money-like exactness, so the declared precision and
  // scale must reach the column. SQLite has no parameterised decimal, so its
  // NUMERIC affinity is the closest equivalent.
  it("types a dbType:decimal number field as an exact decimal column", () => {
    const expected: Record<SupportedDialect, string> = {
      postgresql: "NUMERIC(10, 2)",
      mysql: "DECIMAL(10, 2)",
      sqlite: "NUMERIC",
    };
    for (const dialect of Object.keys(expected) as SupportedDialect[]) {
      const q = QUOTE[dialect];
      const sql = columnSql(
        dialect,
        numberField({ dbType: "decimal", precision: 10, scale: 2 })
      );
      expect(sql).toContain(`${q}value${q} ${expected[dialect]}`);
    }
  });

  // format:"float" opts into approximate storage. Each dialect's value is the
  // 8-byte type the runtime's `doublePrecision`/`double`/`real` column maps to,
  // not merely "some float" — PostgreSQL REAL (float4) would not match.
  it("types an options.format:float number field as a floating-point column", () => {
    const expected: Record<SupportedDialect, string> = {
      postgresql: "DOUBLE PRECISION",
      mysql: "DOUBLE",
      sqlite: "REAL",
    };
    for (const dialect of Object.keys(expected) as SupportedDialect[]) {
      const q = QUOTE[dialect];
      const sql = columnSql(
        dialect,
        numberField({ options: { format: "float" } })
      );
      expect(sql).toContain(`${q}value${q} ${expected[dialect]}`);
    }
  });
});

// The alter path skips fields it considers unmodified. Since a number field's
// physical column is chosen by dbType/precision/scale rather than `type`, those
// have to participate in that comparison or a storage change silently leaves
// the old column in place.
describe("ComponentSchemaService number storage change detection", () => {
  const alterSql = (before: FieldConfig, after: FieldConfig): string =>
    new ComponentSchemaService("postgresql").generateAlterTableMigration(
      "comp_widget",
      [before],
      [after]
    );

  it("alters the column when a number field switches to an exact decimal", () => {
    const sql = alterSql(
      numberField(),
      numberField({ dbType: "decimal", precision: 10, scale: 2 })
    );
    expect(sql).toContain("NUMERIC(10, 2)");
  });

  it("alters the column when a decimal's precision or scale changes", () => {
    const sql = alterSql(
      numberField({ dbType: "decimal", precision: 10, scale: 2 }),
      numberField({ dbType: "decimal", precision: 12, scale: 4 })
    );
    expect(sql).toContain("NUMERIC(12, 4)");
  });

  it("emits nothing when the storage settings are unchanged", () => {
    const sql = alterSql(
      numberField({ dbType: "decimal", precision: 10, scale: 2 }),
      numberField({ dbType: "decimal", precision: 10, scale: 2 })
    );
    expect(sql).not.toContain("ALTER COLUMN");
  });
});
