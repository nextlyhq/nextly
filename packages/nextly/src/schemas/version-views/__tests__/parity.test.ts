/**
 * The three dialect tables are hand-mirrored from `../postgres.ts`, so a
 * column added to one and forgotten in another is the failure to catch, and a
 * table declared but never registered as a core table is created on SQLite
 * only, by its bootstrap DDL.
 *
 * @module schemas/version-views/__tests__/parity.test
 */
import { Column, is, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { CORE_TABLE_NAMES, getCoreSchema } from "../../index";
import { my, pg, sl } from "../index";

/** Property and column names, by asking Drizzle what each property is. */
const columnNames = (table: Table): string[] =>
  Object.entries(table)
    .filter((entry): entry is [string, Column] => is(entry[1], Column))
    .map(([property, column]) => `${property}:${column.name}`)
    .sort();

describe("nextly_version_views is identical across dialects", () => {
  it("has the same columns everywhere", () => {
    const canonical = columnNames(pg.nextlyVersionViewsPg);
    // The control: an empty list would satisfy the comparisons by absence.
    expect(canonical.length).toBeGreaterThan(0);
    expect(columnNames(my.nextlyVersionViewsMysql)).toEqual(canonical);
    expect(columnNames(sl.nextlyVersionViewsSqlite)).toEqual(canonical);
  });

  it("carries the view_key digest the one-marker rule is enforced on", () => {
    for (const table of [
      pg.nextlyVersionViewsPg,
      my.nextlyVersionViewsMysql,
      sl.nextlyVersionViewsSqlite,
    ]) {
      expect(columnNames(table)).toContain("viewKey:view_key");
    }
  });
});

describe("nextly_version_views is registered as a core table", () => {
  it("is named in CORE_TABLE_NAMES", () => {
    expect(CORE_TABLE_NAMES).toContain("nextly_version_views");
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "appears in the %s core schema snapshot",
    dialect => {
      const names = getCoreSchema(dialect).tables.map(t => t.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain("nextly_version_views");
    }
  );
});
