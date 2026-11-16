/**
 * The three dialect tables are hand-mirrored from `../postgres.ts`, so a
 * column added to one and forgotten in another is the failure to catch, and a
 * table declared but never registered as a core table is created on SQLite
 * only, by its bootstrap DDL.
 *
 * @module schemas/version-views/__tests__/parity.test
 */
import { Column, is, type Table } from "drizzle-orm";
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it, beforeAll } from "vitest";

import { CORE_TABLE_NAMES, getCoreSchema } from "../../index";
import * as my from "../mysql";
import * as pg from "../postgres";
import * as sl from "../sqlite";
import { loadDialectTables } from "../../../database/dialect-tables";

// The postgresql and mysql tables this file reads; the unit setup loads only
// the run's own dialect, as an app's adapter would.
beforeAll(async () => {
  await Promise.all(["postgresql", "mysql"].map(d => loadDialectTables(d)));
});

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

  it("enforces one marker per person, document and part with a unique index on view_key alone", () => {
    // The index itself, not the column: a dialect that kept the column and
    // lost the unique index would let two first marks of one marker both
    // insert, and a read would then find either.
    const indexes = [
      pgTableConfig(pg.nextlyVersionViewsPg).indexes,
      mysqlTableConfig(my.nextlyVersionViewsMysql).indexes,
      sqliteTableConfig(sl.nextlyVersionViewsSqlite).indexes,
    ];
    for (const declared of indexes) {
      const onViewKey = declared
        .map(index => index.config)
        .filter(config =>
          config.columns.every(
            column => "name" in column && column.name === "view_key"
          )
        );
      expect(onViewKey).toEqual([
        expect.objectContaining({
          name: "nextly_version_views_key_uidx",
          unique: true,
        }),
      ]);
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
