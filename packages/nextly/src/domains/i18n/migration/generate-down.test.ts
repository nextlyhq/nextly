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
  it("never brings `_updated_at` home to the main table", () => {
    const sql = buildLocalizationDownSql(spec);

    // 🔴 Disabling localization re-adds the TRANSLATED columns to main and drops
    // the companion. `_updated_at` is structural, not translated -- it records
    // when a locale was written, and a main table has no locales -- so re-adding
    // it would put a companion's bookkeeping column on the content table and
    // leave it there permanently, since this path is not reversible.
    //
    // It holds by construction rather than by a filter: the down path renders
    // `spec.columns`, which `deriveCompanionSpec` builds from localized FIELDS,
    // and `_updated_at` is not a field. Pinned anyway, because the next author
    // to add a structural column may well reach for `spec.columns` to carry it.
    expect(sql).not.toContain(`"_updated_at"`);

    // The must-be-found control. This assertion is satisfied by absence, so on
    // its own it would pass just as happily against an empty string or a
    // renamed helper. The translated column proves the search can find a column
    // name in this output at all.
    expect(sql).toContain(`"title"`);
  });

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
    const statements = buildLocalizationDownStatements(spec, {
      restoreStatus: true,
    });
    expect(statements.join("\n")).toContain(
      `"status" = (SELECT "_status" FROM "dc_pages_locales" ` +
        `WHERE "dc_pages_locales"."_parent" = "dc_pages"."id" ` +
        `ORDER BY ("dc_pages_locales"."_locale" = 'en') DESC, ` +
        `"dc_pages_locales"."_locale" ASC LIMIT 1)`
    );
  });

  it("does not derive the status restore from the desired shape", () => {
    // `spec.status` is what the collection is being saved AS. A save that disables localization
    // and turns Draft/Published on at once would otherwise read a `_status` the old companion
    // never carried, into a `status` main has not been given yet — the disable runs the companion
    // transition before the shared ALTER. Only the caller's physical verdict enables it.
    const desiresStatus = { ...spec, status: true };
    expect(buildLocalizationDownSql(desiresStatus)).not.toContain(`"_status"`);
    expect(
      buildLocalizationDownStatements(desiresStatus).join("\n")
    ).not.toContain(`"_status" `);
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

/**
 * Disabling localization must not narrow the column it is about to fill.
 *
 * The re-added main column is immediately populated FROM the companion, so it has to hold whatever
 * that column can hold. On a MySQL installation created before the shared renderer emitted TEXT, a
 * `longText` companion column is physically LONGTEXT — re-adding TEXT and copying into it truncates
 * a default-locale value past 65 535 characters, silently on a non-strict server.
 *
 * These statements go into a migration file with no database to introspect, so the target is sized
 * to the widest the source could be rather than read from the live column.
 */
describe("buildLocalizationDownStatements — the restored column's width", () => {
  const longTextSpec = (
    dialect: CompanionMigrationSpec["dialect"]
  ): CompanionMigrationSpec => ({
    ...spec,
    dialect,
    columns: [{ name: "body", kind: "longText" }],
  });

  it("re-adds a MySQL long text column wide enough for a legacy companion", () => {
    expect(buildLocalizationDownStatements(longTextSpec("mysql"))[0]).toContain(
      "ADD COLUMN `body` LONGTEXT"
    );
  });

  // The other dialects have one unbounded text type, so there is nothing wider to reach for.
  it.each(["postgresql", "sqlite"] as const)(
    "keeps TEXT on %s, which has no wider type to restore into",
    dialect => {
      expect(
        buildLocalizationDownStatements(longTextSpec(dialect))[0]
      ).toContain(`ADD COLUMN "body" TEXT`);
    }
  );

  // The narrow kinds are unaffected: only the kind whose renderer changed is widened here.
  it("does not widen a bounded column", () => {
    const bounded: CompanionMigrationSpec = {
      ...spec,
      dialect: "mysql",
      columns: [{ name: "code", kind: "shortText", length: 32 }],
    };
    expect(buildLocalizationDownStatements(bounded)[0]).toContain(
      "ADD COLUMN `code` VARCHAR(32)"
    );
  });
});
