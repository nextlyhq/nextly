/**
 * The brand settings table is hand-mirrored across three dialects, so a column
 * added to one and forgotten in another is the failure to catch. Declaring the
 * table does not create it either: it reaches a database only through the core
 * schema snapshot, `CORE_TABLE_NAMES` and the dialect bundle the push creates.
 *
 * @module schemas/email-brand/__tests__/parity.test
 */
import { Column, getTableName, is, isTable, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getDialectTables } from "../../../database";
import { CORE_TABLE_NAMES, getCoreSchema } from "../../index";
import { EMAIL_BRAND_TABLE, my, pg, sl } from "../index";

/** Property and column name of every column, as the notices parity test reads them. */
const columnNames = (table: Table): string[] =>
  Object.entries(table)
    .filter((entry): entry is [string, Column] => is(entry[1], Column))
    .map(([property, column]) => `${property}:${column.name}`)
    .sort();

describe("the brand settings table is identical across dialects", () => {
  it("has the same columns everywhere", () => {
    const canonical = columnNames(pg.nextlyEmailBrandPg);
    // The control: an empty list would satisfy both comparisons by absence.
    expect(canonical.length).toBeGreaterThan(0);
    expect(columnNames(my.nextlyEmailBrandMysql)).toEqual(canonical);
    expect(columnNames(sl.nextlyEmailBrandSqlite)).toEqual(canonical);
  });

  it("has a column for every setting", () => {
    expect(columnNames(pg.nextlyEmailBrandPg)).toEqual(
      [
        "id:id",
        "logoUrl:logo_url",
        "logoWidth:logo_width",
        "accentColor:accent_color",
        "backgroundColor:background_color",
        "contentColor:content_color",
        "fontFamily:font_family",
        "footerText:footer_text",
        "footerLinks:footer_links",
        "updatedAt:updated_at",
      ].sort()
    );
  });
});

describe("the brand settings table is registered as a core table", () => {
  it("is named in CORE_TABLE_NAMES", () => {
    expect(CORE_TABLE_NAMES).toContain(EMAIL_BRAND_TABLE);
  });

  it.each(["postgresql", "mysql", "sqlite"] as const)(
    "is in the %s core schema snapshot and in the bundle the push creates",
    dialect => {
      const names = getCoreSchema(dialect).tables.map(t => t.name);
      expect(names.length).toBeGreaterThan(0);
      expect(names).toContain(EMAIL_BRAND_TABLE);
      // The bundle is what actually creates tables; a table only in the
      // snapshot is proposed on every reconcile and created by none.
      const bundled = Object.values(getDialectTables(dialect))
        .filter(isTable)
        .map(table => getTableName(table));
      expect(bundled).toContain(EMAIL_BRAND_TABLE);
    }
  );
});
