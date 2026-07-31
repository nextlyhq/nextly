import { describe, it, expect } from "vitest";

import {
  buildDefaultLocaleRestoreStatements,
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

  it("restores each parent from one row, preferring the default locale", () => {
    // The default is a preference rather than a filter, because this statement runs immediately
    // before the companion is archived and DROPPED: a parent skipped for having no default-locale
    // row would keep its pre-localization value while its actual content left with the table.
    // Ranked and limited to one row, so every column comes from the same translation.
    expect(buildLocalizationDownSql(spec)).toContain(
      `UPDATE "dc_pages" SET "title" = (SELECT "title" FROM "dc_pages_locales" ` +
        `WHERE "dc_pages_locales"."_parent" = "dc_pages"."id" ` +
        `ORDER BY ("dc_pages_locales"."_locale" = 'en') DESC, ` +
        `"dc_pages_locales"."_locale" ASC LIMIT 1)`
    );
    // Guarded on the parent having any row at all, so one that never had a translation is left
    // alone rather than blanked.
    expect(buildLocalizationDownSql(spec)).toContain(
      `WHERE EXISTS (SELECT 1 FROM "dc_pages_locales" ` +
        `WHERE "dc_pages_locales"."_parent" = "dc_pages"."id")`
    );
  });

  it("carries the publishing state back with the values it restores", () => {
    // Publishing is per locale while an entity is localized, so a row published only under a
    // non-default language holds that state on its companion row alone. This migration drops the
    // companion immediately afterwards, so a restore that moved the content without the state it
    // was published under would put a draft in front of the public — or take live content down —
    // with nothing left to correct it from.
    const withStatus = { ...spec, status: true };
    const sql = buildLocalizationDownSql(withStatus);
    expect(sql).toContain(
      `"status" = (SELECT "_status" FROM "dc_pages_locales" ` +
        `WHERE "dc_pages_locales"."_parent" = "dc_pages"."id" ` +
        `ORDER BY ("dc_pages_locales"."_locale" = 'en') DESC, ` +
        `"dc_pages_locales"."_locale" ASC LIMIT 1)`
    );
  });

  it("does not touch status for an entity without Draft/Published", () => {
    // `status` and `_status` only exist when the entity has Draft/Published. Reading either
    // without it fails the whole migration, so the assignment is gated rather than defaulted.
    expect(buildLocalizationDownSql(spec)).not.toContain(`"_status"`);
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

describe("buildDefaultLocaleRestoreStatements", () => {
  const spec = {
    dialect: "postgresql" as const,
    mainTable: "dc_posts",
    companionTable: "dc_posts_locales",
    defaultLocale: "en",
  };

  it("restores every column in one statement", () => {
    // Several statements can land half-applied: one failing after earlier ones committed leaves
    // main carrying a mixture of restored and pre-localization values, with no record that a
    // restore was attempted. The app then serves that mixture and accepts edits on it, and the
    // next pass overwrites them from the now-stale companion.
    const statements = buildDefaultLocaleRestoreStatements(spec, [
      "title",
      "body",
      "excerpt",
    ]);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('"title" = (SELECT "title"');
    expect(statements[0]).toContain('"body" = (SELECT "body"');
    expect(statements[0]).toContain('"excerpt" = (SELECT "excerpt"');
  });

  it("guards on the default-locale row existing", () => {
    // Without it a row authored only in another language assigns SQL NULL, so the restore blanks
    // the main column instead of leaving it alone. There is nothing to restore for such a row.
    const [statement] = buildDefaultLocaleRestoreStatements(spec, ["title"]);

    expect(statement).toContain("WHERE EXISTS (SELECT 1 FROM");
  });

  it("emits nothing when there is nothing to restore", () => {
    expect(buildDefaultLocaleRestoreStatements(spec, [])).toEqual([]);
  });
});
