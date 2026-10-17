/**
 * The notices table is hand-mirrored across three dialects, so a column added
 * to one and forgotten in another is the failure to catch, and declaring a
 * table does not create it: it reaches a database only through the core
 * schema snapshot, `CORE_TABLE_NAMES` and the dialect bundle that the push
 * creates. A table in some of those and not others works on one dialect and is
 * absent on the rest.
 *
 * @module schemas/notices/__tests__/parity.test
 */
import { Column, getTableName, is, isTable, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database";
import { CORE_TABLE_NAMES, getCoreSchema } from "../../index";
import { my, NOTICES_TABLE, pg, sl } from "../index";

/** Property and column name of every column, as `releases`' parity test reads them. */
const columnNames = (table: Table): string[] =>
  Object.entries(table)
    .filter((entry): entry is [string, Column] => is(entry[1], Column))
    .map(([property, column]) => `${property}:${column.name}`)
    .sort();

describe("the notices table is identical across dialects", () => {
  it("has the same columns everywhere", () => {
    const canonical = columnNames(pg.nextlyNoticesPg);
    // The control: an empty list would satisfy both comparisons by absence.
    expect(canonical.length).toBeGreaterThan(0);
    expect(columnNames(my.nextlyNoticesMysql)).toEqual(canonical);
    expect(columnNames(sl.nextlyNoticesSqlite)).toEqual(canonical);
  });

  it("carries the dedupe digest, which once-per-occurrence rests on", () => {
    for (const table of [
      pg.nextlyNoticesPg,
      my.nextlyNoticesMysql,
      sl.nextlyNoticesSqlite,
    ]) {
      expect(columnNames(table)).toContain("dedupeKey:dedupe_key");
      expect(columnNames(table)).toContain("readAt:read_at");
    }
  });
});

describe("the notices table is registered as a core table", () => {
  it("is named in CORE_TABLE_NAMES", () => {
    expect(CORE_TABLE_NAMES).toContain(NOTICES_TABLE);
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "is in the %s core schema snapshot and in the bundle the push creates",
    dialect => {
      const names = getCoreSchema(dialect).tables.map(t => t.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain(NOTICES_TABLE);
      // The bundle is what actually creates tables; a table only in the
      // snapshot is proposed on every reconcile and created by none.
      const bundled = Object.values(getDialectTables(dialect))
        .filter(isTable)
        .map(table => getTableName(table));
      expect(bundled).toContain(NOTICES_TABLE);
    }
  );
});
