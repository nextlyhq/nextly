/**
 * The url and phone user field types are validated as text but must still get a
 * real text-family column in user_ext (not skipped, not defaulted to another
 * primitive). Two independent code paths build that column and must not
 * diverge: the DDL string from generateMigrationSQL (getColumnType) and the
 * Drizzle runtime table from generateRuntimeSchema (mapFieldTo*Column). Both
 * are asserted below.
 */
import { describe, expect, it } from "vitest";

import type { UserFieldConfig } from "../../../../users/config/types";
import { UserExtSchemaService } from "../user-ext-schema-service";

// A user field of the given built-in type; only name/type drive the mapping.
function field(name: string, type: string): UserFieldConfig {
  return { name, label: name, type } as unknown as UserFieldConfig;
}

// Read a generated Drizzle column's SQL type (e.g. "varchar(255)", "text").
function sqlType(table: Record<string, unknown>, name: string): string {
  return (table[name] as { getSQLType: () => string }).getSQLType();
}

describe("UserExtSchemaService — built-in url/phone DDL columns", () => {
  it("maps url and phone to varchar columns on postgres", () => {
    // Postgres sizes these text-family columns as varchar(maxLength ?? 255).
    const sql = new UserExtSchemaService("postgresql").generateMigrationSQL([
      field("website", "url"),
      field("mobile", "phone"),
    ]);
    expect(sql).toMatch(/"website"\s+VARCHAR\(255\)/i);
    expect(sql).toMatch(/"mobile"\s+VARCHAR\(255\)/i);
  });

  it("maps url and phone to text columns on sqlite", () => {
    // SQLite has no varchar sizing, so the same fields land as TEXT.
    const sql = new UserExtSchemaService("sqlite").generateMigrationSQL([
      field("website", "url"),
      field("mobile", "phone"),
    ]);
    expect(sql).toMatch(/"website"\s+TEXT/i);
    expect(sql).toMatch(/"mobile"\s+TEXT/i);
  });
});

describe("UserExtSchemaService — built-in url/phone runtime columns", () => {
  it("builds varchar(255) runtime columns for url and phone on postgres", () => {
    // The Drizzle table used for live queries must match the DDL above, or
    // reads/writes would target a column shape the migration never created.
    const table = new UserExtSchemaService("postgresql").generateRuntimeSchema([
      field("website", "url"),
      field("mobile", "phone"),
    ]);
    expect(sqlType(table, "website")).toBe("varchar(255)");
    expect(sqlType(table, "mobile")).toBe("varchar(255)");
  });

  it("builds text runtime columns for url and phone on sqlite", () => {
    // SQLite stores these text-family fields as text, matching the generated DDL.
    const table = new UserExtSchemaService("sqlite").generateRuntimeSchema([
      field("website", "url"),
      field("mobile", "phone"),
    ]);
    expect(sqlType(table, "website")).toBe("text");
    expect(sqlType(table, "mobile")).toBe("text");
  });
});
