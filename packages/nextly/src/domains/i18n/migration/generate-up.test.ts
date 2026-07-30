import { describe, it, expect } from "vitest";

import {
  buildCompanionCreateOnlySql,
  buildLocalizationUpSql,
  buildLocalizationUpStatements,
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

describe.each(["sqlite", "postgresql", "mysql"] as const)(
  "buildLocalizationUpStatements without the drop on %s",
  dialect => {
    it("still copies the existing values into the companion", () => {
      // Unattended provisioning is additive-only, but the copy is the entire point: without it
      // the companion is empty and every localized field reads null over content still on disk.
      const statements = buildLocalizationUpStatements(spec(dialect), {
        dropSeededColumns: false,
      });

      expect(statements.some(s => s.startsWith("INSERT INTO"))).toBe(true);
    });

    it("leaves the main table's columns in place", () => {
      // A dropped column is not something the next boot can put back, so unattended paths must
      // not drop. The redundant copies on main are inert once reads resolve through the companion.
      const statements = buildLocalizationUpStatements(spec(dialect), {
        dropSeededColumns: false,
      });

      expect(statements.some(s => s.includes("DROP COLUMN"))).toBe(false);
    });

    it("drops by default, so the Builder toggle and migration files are unchanged", () => {
      // Both existing callers relocate the data deliberately; leaving the originals would give a
      // field two homes and let the stale one be read after an edit.
      const statements = buildLocalizationUpStatements(spec(dialect));

      expect(statements.filter(s => s.includes("DROP COLUMN")).length).toBe(2);
    });
  }
);
