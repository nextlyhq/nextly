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

const numberField = (extra: Record<string, unknown> = {}): FieldConfig =>
  ({ name: "value", type: "number", ...extra }) as unknown as FieldConfig;

function columnSql(dialect: SupportedDialect, field: FieldConfig): string {
  return new ComponentSchemaService(dialect).generateMigrationSQL(
    "comp_widget",
    [field]
  );
}

describe("ComponentSchemaService number column typing", () => {
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

  it("types an options.format:float number field as a floating-point column", () => {
    const expected: Record<SupportedDialect, string> = {
      postgresql: "REAL",
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
