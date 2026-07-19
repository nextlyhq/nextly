import { describe, it, expect } from "vitest";

import {
  buildCompanionCreateOnlySql,
  buildLocalizationUpSql,
} from "./generate-up";
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

describe("buildCompanionCreateOnlySql", () => {
  it("emits only the CREATE (no seed, no drop) for a fresh collection", () => {
    const sql = buildCompanionCreateOnlySql(spec("sqlite"));
    expect(sql).toContain(`CREATE TABLE "dc_pages_locales"`);
    expect(sql).toContain(`PRIMARY KEY ("_parent", "_locale")`);
    expect(sql).toContain(`REFERENCES "dc_pages" ("id") ON DELETE CASCADE`);
    expect(sql).not.toContain("INSERT INTO");
    expect(sql).not.toContain("DROP COLUMN");
    expect(sql.trimEnd().endsWith(");")).toBe(true);
  });
});

describe("per-locale _status column (i18n M6)", () => {
  it("omits _status when the collection has no Draft/Published", () => {
    expect(buildCompanionCreateOnlySql(spec("sqlite"))).not.toContain(
      "_status"
    );
  });

  it("emits a per-locale _status column when status is enabled", () => {
    const sql = buildCompanionCreateOnlySql({
      ...spec("sqlite"),
      status: true,
    });
    expect(sql).toContain(`"_status" VARCHAR(20) NOT NULL DEFAULT 'draft'`);
  });

  it("carries the main row's status into the seed on an enable transition", () => {
    const sql = buildLocalizationUpSql({ ...spec("sqlite"), status: true });
    // both the target _status and the source status column appear in INSERT...SELECT
    expect(sql).toContain(`"_parent", "_locale", "_status", "title", "body"`);
    expect(sql).toContain(`SELECT "id", 'en', "status", "title", "body"`);
  });
});
