import { describe, it, expect } from "vitest";

import { buildLocalizationDownSql } from "./generate-down";
import type { CompanionMigrationSpec } from "./types";

const spec: CompanionMigrationSpec = {
  dialect: "sqlite",
  collection: "pages",
  mainTable: "dc_pages",
  companionTable: "dc_pages_locales",
  defaultLocale: "en",
  parentIdType: "TEXT",
  columns: [{ name: "title", kind: "text" }],
};

describe("buildLocalizationDownSql", () => {
  it("re-adds the relocated column to the main table", () => {
    expect(buildLocalizationDownSql(spec)).toContain(
      `ALTER TABLE "dc_pages" ADD COLUMN "title" TEXT`
    );
  });

  it("restores the default-locale value back onto the main table", () => {
    expect(buildLocalizationDownSql(spec)).toContain(
      `UPDATE "dc_pages" SET "title" = (SELECT "title" FROM "dc_pages_locales" ` +
        `WHERE "dc_pages_locales"."_parent" = "dc_pages"."id" ` +
        `AND "dc_pages_locales"."_locale" = 'en')`
    );
  });

  it("archives non-default-locale translations before dropping", () => {
    const sql = buildLocalizationDownSql(spec);
    expect(sql).toContain(`INSERT INTO "nextly_i18n_archive"`);
    expect(sql).toContain(`WHERE "_locale" <> 'en'`);
    expect(sql).toContain(`'pages'`); // collection literal
    expect(sql).toContain(`'title'`); // field literal
  });

  it("drops the companion table last", () => {
    const sql = buildLocalizationDownSql(spec);
    expect(sql.trimEnd().endsWith(`DROP TABLE "dc_pages_locales";`)).toBe(true);
  });
});
