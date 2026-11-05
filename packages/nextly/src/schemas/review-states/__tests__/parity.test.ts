/**
 * The three dialect tables are hand-mirrored from `../postgres.ts`, so a column added to one and
 * forgotten in another is the failure to catch, and a table declared but never registered as a
 * core table is created on SQLite only, by its bootstrap DDL.
 *
 * @module schemas/review-states/__tests__/parity.test
 */
import { Column, is, type Table } from "drizzle-orm";
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import { beforeAll, describe, expect, it } from "vitest";

import { loadDialectTables } from "../../../database/dialect-tables";
import { CORE_TABLE_NAMES, getCoreSchema } from "../../index";
import * as my from "../mysql";
import * as pg from "../postgres";
import * as sl from "../sqlite";

// The postgresql and mysql tables this file reads; the unit setup loads only the run's own dialect.
beforeAll(async () => {
  await Promise.all(["postgresql", "mysql"].map(d => loadDialectTables(d)));
});

/** Property and column names, by asking Drizzle what each property is. */
const columnNames = (table: Table): string[] =>
  Object.entries(table)
    .filter((entry): entry is [string, Column] => is(entry[1], Column))
    .map(([property, column]) => `${property}:${column.name}`)
    .sort();

describe("nextly_review_states is identical across dialects", () => {
  it("has the same columns everywhere", () => {
    const canonical = columnNames(pg.nextlyReviewStatesPg);
    // The control: an empty list would satisfy the comparisons by absence.
    expect(canonical.length).toBeGreaterThan(0);
    expect(columnNames(my.nextlyReviewStatesMysql)).toEqual(canonical);
    expect(columnNames(sl.nextlyReviewStatesSqlite)).toEqual(canonical);
  });

  it("enforces one row per document and part with a unique index on part_key alone", () => {
    const indexes = [
      pgTableConfig(pg.nextlyReviewStatesPg).indexes,
      mysqlTableConfig(my.nextlyReviewStatesMysql).indexes,
      sqliteTableConfig(sl.nextlyReviewStatesSqlite).indexes,
    ];
    for (const declared of indexes) {
      const onPartKey = declared
        .map(index => index.config)
        .filter(config =>
          config.columns.every(
            column => "name" in column && column.name === "part_key"
          )
        );
      expect(onPartKey).toEqual([
        expect.objectContaining({
          name: "nextly_review_states_key_uidx",
          unique: true,
        }),
      ]);
    }
  });

  it("adds no column to a content table: every column is its own", () => {
    for (const table of [
      pgTableConfig(pg.nextlyReviewStatesPg),
      mysqlTableConfig(my.nextlyReviewStatesMysql),
      sqliteTableConfig(sl.nextlyReviewStatesSqlite),
    ]) {
      expect(table.name).toBe("nextly_review_states");
      expect(table.foreignKeys).toEqual([]);
    }
  });
});

describe("nextly_review_states is registered as a core table", () => {
  it("is named in CORE_TABLE_NAMES", () => {
    expect(CORE_TABLE_NAMES).toContain("nextly_review_states");
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "appears in the %s core schema snapshot",
    dialect => {
      const names = getCoreSchema(dialect).tables.map(t => t.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain("nextly_review_states");
    }
  );
});
