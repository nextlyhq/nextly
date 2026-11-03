/**
 * The three dialect tables are hand-mirrored from `../postgres.ts`, so a column added to one and
 * forgotten in another is the failure to catch, and a table declared but never registered as a
 * core table is created on SQLite only, by its bootstrap DDL.
 *
 * @module schemas/workflow-settings/__tests__/parity.test
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

beforeAll(async () => {
  await Promise.all(["postgresql", "mysql"].map(d => loadDialectTables(d)));
});

const columnNames = (table: Table): string[] =>
  Object.entries(table)
    .filter((entry): entry is [string, Column] => is(entry[1], Column))
    .map(([property, column]) => `${property}:${column.name}`)
    .sort();

describe("nextly_workflow_settings is identical across dialects", () => {
  it("has the same columns everywhere", () => {
    const canonical = columnNames(pg.nextlyWorkflowSettingsPg);
    expect(canonical.length).toBeGreaterThan(0);
    expect(columnNames(my.nextlyWorkflowSettingsMysql)).toEqual(canonical);
    expect(columnNames(sl.nextlyWorkflowSettingsSqlite)).toEqual(canonical);
  });

  it("keeps one row per workflow with a unique index on workflow", () => {
    for (const declared of [
      pgTableConfig(pg.nextlyWorkflowSettingsPg).indexes,
      mysqlTableConfig(my.nextlyWorkflowSettingsMysql).indexes,
      sqliteTableConfig(sl.nextlyWorkflowSettingsSqlite).indexes,
    ]) {
      expect(declared.map(index => index.config)).toEqual([
        expect.objectContaining({
          name: "nextly_workflow_settings_workflow_uidx",
          unique: true,
        }),
      ]);
    }
  });
});

describe("nextly_workflow_settings is registered as a core table", () => {
  it("is named in CORE_TABLE_NAMES", () => {
    expect(CORE_TABLE_NAMES).toContain("nextly_workflow_settings");
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "appears in the %s core schema snapshot",
    dialect => {
      expect(getCoreSchema(dialect).tables.map(t => t.name)).toContain(
        "nextly_workflow_settings"
      );
    }
  );
});
