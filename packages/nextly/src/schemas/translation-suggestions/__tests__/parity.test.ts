/**
 * The three dialect tables are hand-mirrored, so a column added to one and forgotten in another is
 * the failure to catch, and a table declared but never registered as a core table is created on
 * SQLite only, by its bootstrap DDL.
 *
 * @module schemas/translation-suggestions/__tests__/parity.test
 */
import { Column, is, type Table } from "drizzle-orm";
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import { beforeAll, describe, expect, it } from "vitest";

import { loadDialectTables } from "../../../database/dialect-tables";
import { unitKey } from "../../../domains/i18n/pipeline/unit-address";
import { PRINCIPAL_KIND_MAX_LENGTH } from "../../../plugins/principals/registry";
import { CORE_TABLE_NAMES, getCoreSchema } from "../../index";
import * as my from "../mysql";
import * as pg from "../postgres";
import * as sl from "../sqlite";

const TABLE = "nextly_translation_suggestions";

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

const KEY = [
  "scope_kind",
  "scope_slug",
  "entry_id",
  "target_locale",
  "unit_key",
];

/** A MySQL column's declared length in characters. */
const mysqlLength = (name: string): number | undefined =>
  (
    mysqlTableConfig(my.nextlyTranslationSuggestionsMysql).columns.find(
      column => column.name === name
    ) as { length?: number } | undefined
  )?.length;

describe(`${TABLE} is identical across dialects`, () => {
  it("has the same columns everywhere, optional only where nothing may be known", () => {
    const canonical = columnShapes(pg.nextlyTranslationSuggestionsPg);
    // The control: an empty list would satisfy the comparisons by absence.
    expect(canonical).toHaveLength(18);
    expect(columnShapes(my.nextlyTranslationSuggestionsMysql)).toEqual(
      canonical
    );
    expect(columnShapes(sl.nextlyTranslationSuggestionsSqlite)).toEqual(
      canonical
    );
    expect(canonical.filter(shape => shape.endsWith(":optional"))).toEqual([
      "createdById:created_by_id:optional",
      "createdByKind:created_by_kind:optional",
      "createdByPrincipalKind:created_by_principal_kind:optional",
      "engine:engine:optional",
      "model:model:optional",
    ]);
  });

  it("keeps one suggestion per text and language of a document, and finds a field's across documents", () => {
    const expected = [
      {
        name: "nextly_translation_suggestions_field_idx",
        unique: false,
        columns: ["scope_kind", "scope_slug", "field_path"],
      },
      {
        name: "nextly_translation_suggestions_uidx",
        unique: true,
        columns: KEY,
      },
    ];
    expect(
      indexShapes(pgTableConfig(pg.nextlyTranslationSuggestionsPg).indexes)
    ).toEqual(expected);
    expect(
      indexShapes(
        mysqlTableConfig(my.nextlyTranslationSuggestionsMysql).indexes
      )
    ).toEqual(expected);
    expect(
      indexShapes(
        sqliteTableConfig(sl.nextlyTranslationSuggestionsSqlite).indexes
      )
    ).toEqual(expected);
  });

  it("keeps its unique key inside MySQL's 3,072-byte limit, at four bytes a character", () => {
    const characters = KEY.reduce(
      (total, name) => total + (mysqlLength(name) ?? Number.NaN),
      0
    );
    expect(characters * 4).toBe(1988);
    expect(characters * 4).toBeLessThanOrEqual(3072);
  });

  it("adds no column to a content table: every column is its own", () => {
    for (const table of [
      pgTableConfig(pg.nextlyTranslationSuggestionsPg),
      mysqlTableConfig(my.nextlyTranslationSuggestionsMysql),
      sqliteTableConfig(sl.nextlyTranslationSuggestionsSqlite),
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

describe("the suggestions table's widths on MySQL", () => {
  it("hold the longest plugin-defined person's kind a plugin may name", () => {
    // A narrower column refuses a longer kind under strict mode, and the
    // submission that records it fails.
    expect(mysqlLength("created_by_principal_kind")).toBeGreaterThanOrEqual(
      PRINCIPAL_KIND_MAX_LENGTH
    );
  });

  it("hold exactly the key of an address", () => {
    expect(mysqlLength("unit_key")).toBe(unitKey([{ field: "title" }]).length);
  });
});
