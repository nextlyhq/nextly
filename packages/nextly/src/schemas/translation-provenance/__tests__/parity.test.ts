/**
 * The three dialect tables are hand-mirrored, so a column added to one and forgotten in another is
 * the failure to catch, and a table declared but never registered as a core table is created on
 * SQLite only, by its bootstrap DDL.
 *
 * @module schemas/translation-provenance/__tests__/parity.test
 */
import { Column, is, type Table } from "drizzle-orm";
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import { beforeAll, describe, expect, it } from "vitest";

import { loadDialectTables } from "../../../database/dialect-tables";
import { PRINCIPAL_KIND_MAX_LENGTH } from "../../../plugins/principals/registry";
import { CORE_TABLE_NAMES, getCoreSchema } from "../../index";
import * as my from "../mysql";
import * as pg from "../postgres";
import * as sl from "../sqlite";

const TABLE = "nextly_translation_provenance";

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

/** Each declared index, as its name, whether it is unique, and its columns in order. */
const indexShapes = (
  // Each dialect's index config, which differ in their column and flag types.
  declared: readonly {
    config: { name?: string; unique?: boolean; columns: readonly unknown[] };
  }[]
) =>
  declared
    .map(({ config }) => ({
      name: config.name ?? "",
      unique: config.unique === true,
      columns: config.columns.map(column =>
        typeof column === "object" && column !== null && "name" in column
          ? (column as { name: string }).name
          : String(column)
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

describe(`${TABLE} is identical across dialects`, () => {
  it("has the same columns everywhere", () => {
    const canonical = columnNames(pg.nextlyTranslationProvenancePg);
    // The control: an empty list would satisfy the comparisons by absence.
    expect(canonical.length).toBeGreaterThan(0);
    expect(columnNames(my.nextlyTranslationProvenanceMysql)).toEqual(canonical);
    expect(columnNames(sl.nextlyTranslationProvenanceSqlite)).toEqual(
      canonical
    );
  });

  it("keeps one row per field, language and part of a document, and finds a field's rows by document", () => {
    const expected = [
      {
        name: "nextly_translation_provenance_field_idx",
        unique: false,
        columns: [
          "scope_kind",
          "scope_slug",
          "entry_id",
          "field_path",
          "part_state",
        ],
      },
      {
        name: "nextly_translation_provenance_uidx",
        unique: true,
        columns: [
          "scope_kind",
          "scope_slug",
          "entry_id",
          "locale",
          "part_state",
          "field_path",
        ],
      },
    ];
    expect(
      indexShapes(pgTableConfig(pg.nextlyTranslationProvenancePg).indexes)
    ).toEqual(expected);
    expect(
      indexShapes(mysqlTableConfig(my.nextlyTranslationProvenanceMysql).indexes)
    ).toEqual(expected);
    expect(
      indexShapes(
        sqliteTableConfig(sl.nextlyTranslationProvenanceSqlite).indexes
      )
    ).toEqual(expected);
  });

  it("adds no column to a content table: every column is its own", () => {
    for (const table of [
      pgTableConfig(pg.nextlyTranslationProvenancePg),
      mysqlTableConfig(my.nextlyTranslationProvenanceMysql),
      sqliteTableConfig(sl.nextlyTranslationProvenanceSqlite),
    ]) {
      expect(table.name).toBe(TABLE);
      expect(table.foreignKeys).toEqual([]);
    }
  });
});

describe(`${TABLE} is registered as a core table`, () => {
  it("is named in CORE_TABLE_NAMES", () => {
    expect(CORE_TABLE_NAMES).toContain(TABLE);
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "appears in the %s core schema snapshot",
    dialect => {
      const names = getCoreSchema(dialect).tables.map(t => t.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain(TABLE);
    }
  );
});

describe("the provenance table keeps who wrote a value", () => {
  it("holds the longest plugin-defined person's kind a plugin may name, on MySQL", () => {
    // MySQL keeps the kind in a varchar: a narrower one refuses a longer kind
    // under strict mode, and the save that records it rolls back with it.
    const column = mysqlTableConfig(
      my.nextlyTranslationProvenanceMysql
    ).columns.find(col => col.name === "actor_principal_kind") as
      | { length?: number }
      | undefined;
    expect(column?.length).toBeGreaterThanOrEqual(PRINCIPAL_KIND_MAX_LENGTH);
  });
});
