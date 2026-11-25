/**
 * The three dialect tables are hand-mirrored, so a column added to one and forgotten in another is
 * the failure to catch, and a table declared but never registered as a core table is created on
 * SQLite only, by its bootstrap DDL.
 *
 * @module schemas/translation-sources/__tests__/parity.test
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

const TABLE = "nextly_translation_sources";

// Every dialect's tables this file reads, its own run's included: the unit setup loads only the
// run's dialect (`DB_DIALECT`), so the cases for the other two would otherwise throw.
beforeAll(async () => {
  await Promise.all(
    ["postgresql", "mysql", "sqlite"].map(d => loadDialectTables(d))
  );
});

/** Property, column name and whether it may be null, by asking Drizzle what each property is. */
const columnShapes = (table: Table): string[] =>
  Object.entries(table)
    .filter((entry): entry is [string, Column] => is(entry[1], Column))
    .map(
      ([property, column]) =>
        `${property}:${column.name}:${column.notNull ? "required" : "optional"}`
    )
    .sort();

/** Each declared index, as its name, whether it is unique, and its columns in order. */
const indexShapes = (
  // Each dialect's index config, which differ in their column and flag types.
  declared: readonly {
    config: { name?: string; unique?: boolean; columns: readonly unknown[] };
  }[]
) =>
  declared.map(({ config }) => ({
    name: config.name ?? "",
    unique: config.unique === true,
    columns: config.columns.map(column =>
      typeof column === "object" && column !== null && "name" in column
        ? (column as { name: string }).name
        : String(column)
    ),
  }));

const KEY = [
  "scope_kind",
  "scope_slug",
  "entry_id",
  "source_locale",
  "field_path",
  "fingerprint",
];

describe(`${TABLE} is identical across dialects`, () => {
  it("has the same columns everywhere, every one of them required", () => {
    const canonical = columnShapes(pg.nextlyTranslationSourcesPg);
    // The control: an empty list would satisfy the comparisons by absence.
    expect(canonical.length).toBeGreaterThan(0);
    expect(canonical.filter(shape => !shape.endsWith(":required"))).toEqual([]);
    expect(columnShapes(my.nextlyTranslationSourcesMysql)).toEqual(canonical);
    expect(columnShapes(sl.nextlyTranslationSourcesSqlite)).toEqual(canonical);
  });

  it("keeps one row per version of one field's source text", () => {
    const expected = [
      { name: "nextly_translation_sources_uidx", unique: true, columns: KEY },
    ];
    expect(
      indexShapes(pgTableConfig(pg.nextlyTranslationSourcesPg).indexes)
    ).toEqual(expected);
    expect(
      indexShapes(mysqlTableConfig(my.nextlyTranslationSourcesMysql).indexes)
    ).toEqual(expected);
    expect(
      indexShapes(sqliteTableConfig(sl.nextlyTranslationSourcesSqlite).indexes)
    ).toEqual(expected);
  });

  it("keeps its unique key inside MySQL's 3072-byte limit, at four bytes a character", () => {
    const lengths = mysqlTableConfig(my.nextlyTranslationSourcesMysql)
      .columns.filter(column => KEY.includes(column.name))
      .map(column => (column as { length?: number }).length ?? Number.NaN);
    expect(lengths).toHaveLength(KEY.length);
    expect(
      lengths.reduce((total, length) => total + length, 0) * 4
    ).toBeLessThanOrEqual(3072);
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
