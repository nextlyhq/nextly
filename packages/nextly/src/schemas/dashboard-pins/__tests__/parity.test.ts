/**
 * The dashboard pins and preferences tables are hand-mirrored across three
 * dialects, so a column added to one and forgotten in another is the failure
 * to catch. And declaring a table does not create it: it reaches a database
 * only through the core schema snapshot, `CORE_TABLE_NAMES` and the dialect
 * bundle that the push creates. A table in some of those and not others works
 * on one dialect and is absent on the rest.
 *
 * @module schemas/dashboard-pins/__tests__/parity.test
 */
import { Column, getTableName, is, isTable, type Table } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database";
import { loadDialectTables } from "../../../database/dialect-tables";
import * as prefsMy from "../../dashboard-preferences/mysql";
import * as prefsPg from "../../dashboard-preferences/postgres";
import * as prefsSl from "../../dashboard-preferences/sqlite";
import { DASHBOARD_PREFERENCES_TABLE } from "../../dashboard-preferences/table-name";
import { CORE_TABLE_NAMES, getCoreSchema } from "../../index";
import * as pinsMy from "../mysql";
import * as pinsPg from "../postgres";
import * as pinsSl from "../sqlite";
import { DASHBOARD_PINS_TABLE } from "../table-name";

// The postgresql and mysql tables this file reads; the unit setup loads only
// the run's own dialect, as an app's adapter would.
beforeAll(async () => {
  await Promise.all(["postgresql", "mysql"].map(d => loadDialectTables(d)));
});

/** Property and column name of every column, as `notices`' parity test reads them. */
const columnNames = (table: Table): string[] =>
  Object.entries(table)
    .filter((entry): entry is [string, Column] => is(entry[1], Column))
    .map(([property, column]) => `${property}:${column.name}`)
    .sort();

describe("the dashboard tables are identical across dialects", () => {
  it.each([
    [
      "pins",
      pinsPg.nextlyDashboardPinsPg,
      pinsMy.nextlyDashboardPinsMysql,
      pinsSl.nextlyDashboardPinsSqlite,
    ],
    [
      "preferences",
      prefsPg.nextlyDashboardPreferencesPg,
      prefsMy.nextlyDashboardPreferencesMysql,
      prefsSl.nextlyDashboardPreferencesSqlite,
    ],
  ] as const)(
    "the %s table has the same columns everywhere",
    (_, pg, my, sl) => {
      const canonical = columnNames(pg);
      // The control: an empty list would satisfy both comparisons by absence.
      expect(canonical.length).toBeGreaterThan(0);
      expect(columnNames(my)).toEqual(canonical);
      expect(columnNames(sl)).toEqual(canonical);
    }
  );

  it("keys a pin by its reader and target, a Single's entry included", () => {
    expect(columnNames(pinsPg.nextlyDashboardPinsPg)).toEqual([
      "entryId:entry_id",
      "id:id",
      "pinnedAt:pinned_at",
      "targetSlug:target_slug",
      "targetType:target_type",
      "userId:user_id",
    ]);
    expect(columnNames(prefsPg.nextlyDashboardPreferencesPg)).toEqual([
      "id:id",
      "key:preference_key",
      "updatedAt:updated_at",
      "userId:user_id",
      "value:value",
    ]);
  });
});

describe("the dashboard tables are registered as core tables", () => {
  it("are named in CORE_TABLE_NAMES", () => {
    expect(CORE_TABLE_NAMES).toContain(DASHBOARD_PINS_TABLE);
    expect(CORE_TABLE_NAMES).toContain(DASHBOARD_PREFERENCES_TABLE);
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "are in the %s core schema snapshot and in the bundle the push creates",
    dialect => {
      const names = getCoreSchema(dialect).tables.map(t => t.name);
      expect(names.length).toBeGreaterThan(0);
      // The bundle is what actually creates tables; a table only in the
      // snapshot is proposed on every reconcile and created by none.
      const bundled = Object.values(getDialectTables(dialect))
        .filter(isTable)
        .map(table => getTableName(table));
      for (const table of [DASHBOARD_PINS_TABLE, DASHBOARD_PREFERENCES_TABLE]) {
        expect(names).toContain(table);
        expect(bundled).toContain(table);
      }
    }
  );
});
