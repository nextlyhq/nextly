/**
 * The content event tables are hand-mirrored from `../postgres.ts`, so a
 * column added to one dialect and forgotten in another is the failure to
 * catch, and a table declared but never registered as a core table is created
 * on SQLite only, by its bootstrap DDL.
 *
 * @module schemas/content-events/__tests__/parity.test
 */
import { Column, is, type Table } from "drizzle-orm";
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { CORE_TABLE_NAMES, getCoreSchema } from "../../index";
import { my, pg, sl } from "../index";

/** Property and column names, by asking Drizzle what each property is. */
const columnNames = (table: Table): string[] =>
  Object.entries(table)
    .filter((entry): entry is [string, Column] => is(entry[1], Column))
    .map(([property, column]) => `${property}:${column.name}`)
    .sort();

describe("the content event tables are identical across dialects", () => {
  it.each([
    [
      pg.nextlyContentEventsPg,
      my.nextlyContentEventsMysql,
      sl.nextlyContentEventsSqlite,
    ],
    [
      pg.nextlyContentEventPartsPg,
      my.nextlyContentEventPartsMysql,
      sl.nextlyContentEventPartsSqlite,
    ],
  ])("has the same columns everywhere", (pgTable, myTable, slTable) => {
    const canonical = columnNames(pgTable);
    // The control: an empty list would satisfy the comparisons by absence.
    expect(canonical.length).toBeGreaterThan(0);
    expect(columnNames(myTable)).toEqual(canonical);
    expect(columnNames(slTable)).toEqual(canonical);
  });

  it("keys each part row on its event and part, so a part is held once", () => {
    const keys = [
      pgTableConfig(pg.nextlyContentEventPartsPg).primaryKeys,
      mysqlTableConfig(my.nextlyContentEventPartsMysql).primaryKeys,
      sqliteTableConfig(sl.nextlyContentEventPartsSqlite).primaryKeys,
    ];
    for (const declared of keys) {
      expect(declared).toHaveLength(1);
      expect(declared[0]?.columns.map(column => column.name)).toEqual([
        "event_id",
        "part",
      ]);
    }
  });
});

describe("the content event tables are registered as core tables", () => {
  it("are named in CORE_TABLE_NAMES", () => {
    expect(CORE_TABLE_NAMES).toContain("nextly_content_events");
    expect(CORE_TABLE_NAMES).toContain("nextly_content_event_parts");
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "appear in the %s core schema snapshot",
    dialect => {
      const names = getCoreSchema(dialect).tables.map(t => t.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain("nextly_content_events");
      expect(names).toContain("nextly_content_event_parts");
    }
  );
});
