import { describe, it, expect } from "vitest";

import { buildLocalizationUpSql } from "./generate-up";
import type { CompanionMigrationSpec } from "./types";

const spec = (
  dialect: CompanionMigrationSpec["dialect"]
): CompanionMigrationSpec => ({
  dialect,
  collection: "pages",
  mainTable: "dc_pages",
  companionTable: "dc_pages_locales",
  defaultLocale: "en",
  parentIdType: "TEXT",
  columns: [
    { name: "title", kind: "text" },
    { name: "body", kind: "longText" },
  ],
});

describe("buildLocalizationUpSql", () => {
  it("creates the companion table with composite PK and FK", () => {
    const sql = buildLocalizationUpSql(spec("sqlite"));
    expect(sql).toContain(`CREATE TABLE "dc_pages_locales"`);
    expect(sql).toContain(`PRIMARY KEY ("_parent", "_locale")`);
    expect(sql).toContain(`REFERENCES "dc_pages" ("id") ON DELETE CASCADE`);
  });

  it("seeds existing rows into the default locale via INSERT...SELECT", () => {
    const sql = buildLocalizationUpSql(spec("sqlite"));
    expect(sql).toContain(
      `INSERT INTO "dc_pages_locales" ("_parent", "_locale", "title", "body") ` +
        `SELECT "id", 'en', "title", "body" FROM "dc_pages"`
    );
  });

  it("drops the relocated columns from the main table", () => {
    const sql = buildLocalizationUpSql(spec("sqlite"));
    expect(sql).toContain(`ALTER TABLE "dc_pages" DROP COLUMN "title"`);
    expect(sql).toContain(`ALTER TABLE "dc_pages" DROP COLUMN "body"`);
  });

  it("uses backticks and JSON/type mapping on mysql", () => {
    const sql = buildLocalizationUpSql({
      ...spec("mysql"),
      columns: [{ name: "meta", kind: "json" }],
    });
    expect(sql).toContain("`dc_pages_locales`");
    expect(sql).toContain("`meta` JSON");
  });
});
