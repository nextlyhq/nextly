import { describe, it, expect } from "vitest";

import {
  buildLocalizationDownSql,
  buildLocalizationDownStatements,
} from "./generate-down";
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

describe("buildLocalizationDownStatements when main still carries the column", () => {
  // Unattended provisioning can seed a companion without dropping the columns it copied from, so
  // a later disable meets a main table that still has them.
  const options = { existingMainColumns: ["title"] };

  it("does not re-add a column that is already there", () => {
    // `ADD COLUMN` is not idempotent on any supported dialect, so emitting it here fails the
    // entire disable rather than just that statement.
    const statements = buildLocalizationDownStatements(spec, options);

    expect(statements.some(s => s.includes("ADD COLUMN"))).toBe(false);
  });

  it("still restores the value from the companion", () => {
    // The column's presence says only that it exists. Every localized write since the transition
    // went to the companion alone, so the retained column holds pre-localization content; skipping
    // the restore is exactly what reverts an editor's work without telling them.
    const statements = buildLocalizationDownStatements(spec, options);

    expect(
      statements.some(
        s =>
          s.startsWith(`UPDATE "dc_pages" SET "title" =`) &&
          s.includes(`"dc_pages_locales"`)
      )
    ).toBe(true);
  });

  it("still archives the other languages", () => {
    const statements = buildLocalizationDownStatements(spec, options);

    expect(statements.some(s => s.includes("nextly_i18n_archive"))).toBe(true);
  });

  it("re-adds as before when the column is absent", () => {
    const statements = buildLocalizationDownStatements(spec);

    expect(statements.some(s => s.includes(`ADD COLUMN "title"`))).toBe(true);
  });
});
