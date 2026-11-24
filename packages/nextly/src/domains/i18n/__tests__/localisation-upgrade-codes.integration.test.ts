/**
 * `nextly migrate`'s data steps bring a language code that is not in BCP 47 form (`pt_BR`) to its standard
 * form (`pt-BR`) in every stored row, lists each conversion in its dry run, and serves the old
 * code as the new one; where two configured codes would become the same code it stops, names
 * both, and changes nothing (R-1).
 *
 * The plausible broken upgrades: one that renames the translations' rows but leaves the pending
 * changes (or their keys) under the old code, so the editor's work reads as gone; one that picks
 * one of two colliding codes and merges their rows; and a dry run that lists nothing.
 */
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

import { MIGRATE_DATA_STEPS } from "../../../cli/commands/upgrade-steps";
import { NextlyError } from "../../../errors";
import { runStatement } from "../../schema/pipeline/_internal/run-statement";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { createDynamicHandlers } from "../../../routeHandler";
import type { TestNextly } from "../../../plugins/test-nextly";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { versionPinKey } from "../../versions/version-pins";
import { workingDraftKey } from "../../versions/working-draft-key";
import {
  WORKING_DRAFT_SHAPE,
  type VersionRow,
} from "../../versions/versions-repository";
import { normalizeLocalization } from "../config/normalize";
import { MetaService } from "../../meta/services/meta-service";
import { OLDER_CODES_CHECKED_KEY } from "../older-codes";
import { ensureI18nArchive } from "../migration/ensure-archive";
import { _resetPerLanguageStorage } from "../per-language-storage";

import {
  ARTICLES,
  bootSite,
  migrateData,
  openUpgradeDatabase,
  previewMigrateData,
  refusalBeforeSchemaChanges,
  siteWithLanguages,
  storeUnderCode,
  type UpgradeDatabase,
} from "./helpers/localisation-upgrade-fixture";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

// Written for per-language storage as every installation runs it (`storage-layout`).
perLanguageStorageSuite();

/**
 * A site from before codes were checked: one of its languages written `pt_BR`. Not the default,
 * so a read of it that found nothing would answer in English, never as Portuguese.
 */
const UNDERSCORED = siteWithLanguages(["en", "pt_BR"], "en");
/** The same site written in standard form, which this release writes rows under. */
const STANDARD = siteWithLanguages(["en", "pt-BR"], "en");
/** A site whose configuration holds both spellings of one language. */
const BOTH_SPELLINGS = siteWithLanguages(["en", "pt_BR", "pt-BR"], "en");

describeEachDialect(
  "upgrading a language code into its standard form",
  dialect => {
    let database: UpgradeDatabase | undefined;

    afterEach(async () => {
      await database?.close();
      database = undefined;
      _resetPerLanguageStorage();
      vi.unstubAllEnvs();
    });

    const entriesOf = (t: TestNextly) =>
      (
        t.getService("collectionsHandler") as CollectionsHandler
      ).getEntryService();

    /**
     * One article, live in English and Portuguese and pending in Portuguese, its Portuguese rows
     * stored under `pt_BR` as a release from before codes were checked stored them. This release
     * writes every row under the standard code, so they are written so and then renamed by
     * column, the pending change's key computed from the old code as that release computed it.
     */
    async function legacyArticle(): Promise<string> {
      database = await openUpgradeDatabase(dialect);
      const t = await bootSite(database, "legacy", STANDARD);
      const entries = entriesOf(t);
      const created = await entries.createEntry(
        { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
        {
          title: "hello",
          summary: "summary",
          code: "code-1",
          status: "published",
        }
      );
      const id = (created.data as { id: string }).id;
      const at = (locale: string) => ({
        collectionName: ARTICLES,
        entryId: id,
        locale,
        overrideAccess: true,
      });
      await entries.updateEntry(at("pt-BR"), {
        title: "olá",
        status: "published",
        _overwrite: true,
      });
      await entries.updateEntry(at("pt-BR"), {
        title: "olá 2",
        _overwrite: true,
      });
      await storeUnderCode(database, "pt-BR", "pt_BR");
      // That release recorded no scan for older spellings; this release's boot above, which
      // stood in for it, recorded one before the rows were stored under the older code.
      await database.adapter.delete("nextly_meta", {
        and: [{ column: "key", op: "=", value: OLDER_CODES_CHECKED_KEY }],
      });
      return id;
    }

    /** The languages the article's translations are stored under. */
    async function storedLanguages(): Promise<string[]> {
      const rows = await database!.adapter.queryStatement<{ locale: string }>(
        sql`SELECT DISTINCT ${sql.identifier("_locale")} AS ${sql.identifier("locale")} FROM ${sql.identifier("dc_articles_locales")}`
      );
      return rows.map(row => row.locale).sort();
    }

    /** The article's pending changes: each one's language and its key. */
    async function pendingChanges(
      id: string
    ): Promise<{ locale: string | null; draftKey: string | null }[]> {
      const rows = await database!.adapter.select<VersionRow>(VERSIONS_TABLE, {
        where: {
          and: [
            { column: "entryId", op: "=", value: id },
            ...WORKING_DRAFT_SHAPE,
          ],
        },
      });
      return rows.map(row => ({
        locale: row.locale,
        draftKey: (row as { draftKey?: string | null }).draftKey ?? null,
      }));
    }

    it("stores every row under the standard code, the pending change and its key included", async () => {
      const id = await legacyArticle();

      // The conversion alone: a later step that rewrites whole-document drafts gives them new
      // keys, which would hide a key this one left under the older code.
      await migrateData(
        database!.adapter as never,
        UNDERSCORED,
        MIGRATE_DATA_STEPS.filter(step =>
          step.title.startsWith("convert language codes")
        )
      );

      expect(await storedLanguages()).toEqual(["en", "pt-BR"]);
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: ARTICLES,
        entryId: id,
      };
      expect(await pendingChanges(id)).toEqual([
        { locale: "pt-BR", draftKey: workingDraftKey(ref, "pt-BR") },
      ]);
    });

    it("reads a configuration the loader read, whose codes it holds in standard form", async () => {
      await legacyArticle();
      // As `nextly migrate` hands the steps the configuration: each code in standard form, with
      // the codes it wrote the earlier way named beside them.
      const loaded = {
        ...UNDERSCORED,
        localization: normalizeLocalization({
          locales: [...UNDERSCORED.localization.locales],
          defaultLocale: UNDERSCORED.localization.defaultLocale,
        }),
      };

      await migrateData(database!.adapter as never, loaded);

      expect(await storedLanguages()).toEqual(["en", "pt-BR"]);
    });

    it("rewrites the languages each version records it changed", async () => {
      const id = await legacyArticle();
      const recorded = async () =>
        (
          await database!.adapter.select<{ changedLocales: unknown }>(
            VERSIONS_TABLE,
            {
              columns: ["changedLocales"],
              where: {
                and: [
                  { column: "entryId", op: "=", value: id },
                  { column: "changedLocales", op: "IS NOT NULL" },
                ],
              },
            }
          )
        ).map(row => JSON.stringify(row.changedLocales));
      expect((await recorded()).join()).toMatch(/pt_BR/);

      await migrateData(database!.adapter as never, UNDERSCORED);

      const after = (await recorded()).join();
      expect(after).toMatch(/pt-BR/);
      expect(after).not.toMatch(/pt_BR/);
    });

    it("converts a code an archived translation alone still holds", async () => {
      database = await openUpgradeDatabase(dialect);
      await bootSite(database, "legacy", STANDARD);
      await ensureI18nArchive(database.adapter as never, dialect);
      await database.adapter.insert(
        "nextly_i18n_archive",
        {
          collection: ARTICLES,
          entityKind: "collection",
          entryId: "e1",
          locale: "pt_BR",
          field: "title",
          value: "olá",
          archivedAt: new Date("2026-08-01T10:00:00Z"),
        },
        { returning: [] }
      );

      await migrateData(database.adapter as never, UNDERSCORED);

      const rows = await database.adapter.select<{ locale: string }>(
        "nextly_i18n_archive",
        { columns: ["locale"] }
      );
      expect(rows.map(row => row.locale)).toEqual(["pt-BR"]);
    });

    // A configuration already corrected to the standard code no longer names the older spelling,
    // so it is found from the rows: from every table the conversion rewrites, not only the
    // translation tables. Broken, a spelling left only in the archive or in a version's list of
    // changed languages is never converted, and that row stays out of reach of the language.
    it("converts an older spelling only the archive holds, under a configuration that no longer names it", async () => {
      database = await openUpgradeDatabase(dialect);
      await bootSite(database, "legacy", STANDARD);
      await ensureI18nArchive(database.adapter as never, dialect);
      await database.adapter.insert(
        "nextly_i18n_archive",
        {
          collection: ARTICLES,
          entityKind: "collection",
          entryId: "e1",
          locale: "pt_BR",
          field: "title",
          value: "olá",
          archivedAt: new Date("2026-08-01T10:00:00Z"),
        },
        { returning: [] }
      );

      await migrateData(database.adapter as never, STANDARD);

      const rows = await database.adapter.select<{ locale: string }>(
        "nextly_i18n_archive",
        { columns: ["locale"] }
      );
      expect(rows.map(row => row.locale)).toEqual(["pt-BR"]);
    });

    it("converts an older spelling only a version's changed languages hold, under a configuration that no longer names it", async () => {
      database = await openUpgradeDatabase(dialect);
      const t = await bootSite(database, "legacy", STANDARD);
      const created = await entriesOf(t).createEntry(
        { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
        { title: "hello", code: "code-list", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const [version] = await database.adapter.select<{ id: string }>(
        VERSIONS_TABLE,
        {
          columns: ["id"],
          where: { and: [{ column: "entryId", op: "=", value: id }] },
          limit: 1,
        }
      );
      // The premise: the one place the older spelling is kept.
      await database.adapter.update(
        VERSIONS_TABLE,
        { changedLocales: JSON.stringify(["en", "pt_BR"]) },
        { and: [{ column: "id", op: "=", value: version!.id }] }
      );
      const changed = async () => {
        const [row] = await database!.adapter.select<{
          changedLocales: unknown;
        }>(VERSIONS_TABLE, {
          columns: ["changedLocales"],
          where: { and: [{ column: "id", op: "=", value: version!.id }] },
        });
        const value = row?.changedLocales;
        return typeof value === "string"
          ? (JSON.parse(value) as unknown)
          : value;
      };
      expect(await changed()).toEqual(["en", "pt_BR"]);

      await migrateData(database.adapter as never, STANDARD);

      expect(await changed()).toEqual(["en", "pt-BR"]);
    });

    it("serves the old code as the standard one once upgraded", async () => {
      const id = await legacyArticle();
      await migrateData(database!.adapter as never, UNDERSCORED);

      const t = await bootSite(database!, "upgraded", UNDERSCORED);
      const read = (locale: string) =>
        t.nextly.findByID({
          collection: ARTICLES,
          id,
          locale,
          status: "published",
        });

      expect(await read("pt-BR")).toMatchObject({ title: "olá" });
      expect(await read("pt_BR")).toMatchObject({ title: "olá" });
    });

    // A client still sending the older spelling once the rows are converted writes under the
    // standard code: a write under the older one would sit in a row no read in that language
    // finds, and would be a second translation of the document beside the converted one.
    it("writes a request naming the old code under the standard code once upgraded", async () => {
      const id = await legacyArticle();
      await migrateData(database!.adapter as never, UNDERSCORED);
      const t = await bootSite(database!, "upgraded", UNDERSCORED);

      const written = await entriesOf(t).updateEntry(
        {
          collectionName: ARTICLES,
          entryId: id,
          locale: "pt_BR",
          overrideAccess: true,
        },
        // Saved as the language's pending change: a publish would put live whatever pending
        // change the language already holds, which is not what this case is about.
        { title: "olá 3", _overwrite: true }
      );
      expect(written.success, JSON.stringify(written)).toBe(true);

      expect(await storedLanguages()).toEqual(["en", "pt-BR"]);
      // Wherever the write was kept (a translation row, a version, a pending change), it is kept
      // under the standard code, and nothing is kept under the older one.
      const versions = await database!.adapter.select<{
        locale: string | null;
        snapshot: unknown;
      }>(VERSIONS_TABLE, {
        columns: ["locale", "snapshot"],
        where: { and: [{ column: "entryId", op: "=", value: id }] },
      });
      expect(versions.map(row => row.locale)).not.toContain("pt_BR");
      expect(
        versions.some(
          row =>
            row.locale === "pt-BR" &&
            JSON.stringify(row.snapshot).includes("olá 3")
        )
      ).toBe(true);
    });

    it("lists each conversion in a dry run", async () => {
      await legacyArticle();

      const plan = await previewMigrateData(
        database!.adapter as never,
        UNDERSCORED
      );

      expect(plan.report?.move).toContainEqual(
        expect.stringMatching(/pt_BR.*pt-BR/)
      );
      expect(await storedLanguages()).toEqual(["en", "pt_BR"]);
    });

    it("stops, naming both, where two codes would become one, and changes nothing", async () => {
      await legacyArticle();
      const deps = {
        adapter: database!.adapter as never,
        config: BOTH_SPELLINGS,
      };

      const plan = await previewMigrateData(deps.adapter, deps.config);
      expect(plan.refusals).toEqual([
        expect.stringMatching(/pt_BR.*pt-BR|pt-BR.*pt_BR/),
      ]);

      await expect(migrateData(deps.adapter, deps.config)).rejects.toThrow(
        /pt_BR.*pt-BR|pt-BR.*pt_BR/
      );
      expect(await storedLanguages()).toEqual(["en", "pt_BR"]);
    });

    // The start's warning says to write the standard code in the configuration, and an operator
    // may do that before running the upgrade. The rows still stored under the older spelling are
    // found from the rows themselves, so the start still refuses rather than read the language as
    // empty, and the upgrade still converts them.
    it("refuses to start over rows under an older spelling the configuration no longer names", async () => {
      await legacyArticle();

      // Started as the release that wrote the rows laid them out, so only their language code is
      // out of step with this one.
      await expect(
        bootSite(database!, "legacy", STANDARD, warningsKept().logger)
      ).rejects.toThrow(/pt_BR[\s\S]*nextly migrate/);
    });

    it("converts rows under an older spelling the configuration no longer names", async () => {
      await legacyArticle();

      await migrateData(database!.adapter as never, STANDARD);

      expect(await storedLanguages()).toEqual(["en", "pt-BR"]);
    });

    // The scan for older spellings reads every translation table, so a start that found none
    // records it for the languages it was configured with, and a later start with the same
    // languages does not scan again. Rows stored after that under an older spelling (which only
    // an earlier release wrote) are therefore not looked for: the scan's absence is the evidence.
    // A change to the configured languages scans again.
    it("scans for older spellings once per language configuration", async () => {
      await legacyArticle();
      await migrateData(database!.adapter as never, UNDERSCORED);
      await bootSite(database!, "upgraded", STANDARD, warningsKept().logger);

      await storeUnderCode(database!, "pt-BR", "pt_BR");
      await bootSite(database!, "upgraded", STANDARD, warningsKept().logger);

      await expect(
        bootSite(
          database!,
          "upgraded",
          siteWithLanguages(["en", "pt-BR", "fr"], "en"),
          warningsKept().logger
        )
      ).rejects.toThrow(/pt_BR[\s\S]*nextly migrate/);
    });

    // A database started before the scan read every column a code is stored in recorded its scan
    // over the translation tables alone, in the languages and nothing else. The start reads that
    // record as a scan of fewer columns and scans once more, so a spelling only a newer column
    // holds is found. Broken, the earlier record is taken as this scan's and the start goes on.
    it("scans again a database whose record was written over fewer columns", async () => {
      database = await openUpgradeDatabase(dialect);
      await bootSite(database, "upgraded", STANDARD, warningsKept().logger);
      await ensureI18nArchive(database.adapter as never, dialect);
      await database.adapter.insert(
        "nextly_i18n_archive",
        {
          collection: ARTICLES,
          entityKind: "collection",
          entryId: "e1",
          locale: "pt_BR",
          field: "title",
          value: "olá",
          archivedAt: new Date("2026-08-01T10:00:00Z"),
        },
        { returning: [] }
      );
      // The record as the earlier scan wrote it: the configured languages alone.
      await new MetaService(
        database.adapter as never,
        warningsKept().logger as never
      ).set(OLDER_CODES_CHECKED_KEY, "en,pt-BR");

      await expect(
        bootSite(database, "upgraded", STANDARD, warningsKept().logger)
      ).rejects.toThrow(/pt_BR[\s\S]*nextly migrate/);
    });

    // A site that changed how it wrote a language more than once can hold one document under two
    // older spellings of one code. Both become the same code, so the conversion stops before
    // writing anything, naming both, rather than stop on the unique key after rewriting some
    // tables. MySQL compares codes without regard to case, so it never holds the two apart.
    it.skipIf(dialect === "mysql")(
      "stops before writing anything where two older spellings of one code hold the same document",
      async () => {
        await legacyArticle();
        const table = sql.identifier("dc_articles_locales");
        const [row] = await database!.adapter.queryStatement<
          Record<string, unknown>
        >(
          sql`SELECT * FROM ${table} WHERE ${sql.identifier("_locale")} = ${"pt_BR"}`
        );
        const copy = Object.entries(row!).map(([column, value]) => [
          column,
          column === "_locale"
            ? "PT_br"
            : column === "id"
              ? `${String(value)}-older`
              : value,
        ]);
        await runStatement(
          database!.adapter.getDrizzle(),
          database!.adapter.dialect,
          sql`INSERT INTO ${table} (${sql.join(
            copy.map(([column]) => sql.identifier(String(column))),
            sql`, `
          )}) VALUES (${sql.join(
            copy.map(([, value]) => sql`${value}`),
            sql`, `
          )})`
        );

        await expect(
          migrateData(database!.adapter as never, STANDARD)
        ).rejects.toThrow(/pt_BR[\s\S]*PT_br|PT_br[\s\S]*pt_BR/);

        expect(await storedLanguages()).toEqual(["PT_br", "en", "pt_BR"]);
      }
    );

    /** A copy of the article's `pt_BR` translation row under `locale`: one language kept twice. */
    async function translationAlsoUnder(locale: string): Promise<void> {
      const table = sql.identifier("dc_articles_locales");
      const [row] = await database!.adapter.queryStatement<
        Record<string, unknown>
      >(
        sql`SELECT * FROM ${table} WHERE ${sql.identifier("_locale")} = ${"pt_BR"}`
      );
      const copy = Object.entries(row!).map(([column, value]) => [
        column,
        column === "_locale"
          ? locale
          : column === "id"
            ? `${String(value)}-${locale}`
            : value,
      ]);
      await runStatement(
        database!.adapter.getDrizzle(),
        database!.adapter.dialect,
        sql`INSERT INTO ${table} (${sql.join(
          copy.map(([column]) => sql.identifier(String(column))),
          sql`, `
        )}) VALUES (${sql.join(
          copy.map(([, value]) => sql`${value}`),
          sql`, `
        )})`
      );
    }

    // The translation tables can show one language kept under two spellings as they stand, so
    // `nextly migrate` refuses it before its schema changes, ahead of the version history's check,
    // which waits for the columns those changes add. Broken, that check comes first, its refusal is
    // left for after the schema changes, and the collision is refused only then.
    it("refuses one language under two spellings before the schema changes, on a version history of an earlier release", async () => {
      await legacyArticle();
      await translationAlsoUnder("pt-BR");
      // The version history as an earlier release laid it out, still holding a pending change.
      await runStatement(
        database!.adapter.getDrizzle(),
        database!.adapter.dialect,
        sql`ALTER TABLE ${sql.identifier(VERSIONS_TABLE)} DROP COLUMN ${sql.identifier("changed_locales")}`
      );

      const refusal = await refusalBeforeSchemaChanges(
        database!.adapter,
        STANDARD
      );

      expect(NextlyError.isCode(refusal, "NEXTLY_LANGUAGE_CODES_COLLIDE")).toBe(
        true
      );
      expect(await storedLanguages()).toEqual(["en", "pt-BR", "pt_BR"]);
    });

    // The conversion reads every underscore of a code as a hyphen (`standardLanguageCode`), so a
    // spelling that mixes the two is converted; the discovery of what the rows hold reads it the
    // same way. Broken, it looks the spelling up with only its hyphens read as underscores, never
    // finds `zh_Hant-TW`, and leaves those rows out of reach of the language.
    // A version's list of changed languages can hold a standard code beside an older spelling.
    // Only the older spelling is one: the standard code is no conversion, and none of it
    // collides with itself. Broken, `fr-FR` is taken for an older spelling of itself, and its own
    // rows refuse the run as one language under two codes.
    it("takes only the older spellings from a version's list that holds a standard code too", async () => {
      const THREE = siteWithLanguages(["en", "pt-BR", "fr-FR"], "en");
      database = await openUpgradeDatabase(dialect);
      const t = await bootSite(database, "upgraded", THREE);
      const created = await entriesOf(t).createEntry(
        { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
        {
          title: "hello",
          summary: "s",
          code: "code-list-fr",
          status: "published",
        }
      );
      const id = (created.data as { id: string }).id;
      await entriesOf(t).updateEntry(
        {
          collectionName: ARTICLES,
          entryId: id,
          locale: "fr-FR",
          overrideAccess: true,
        },
        { title: "bonjour", status: "published", _overwrite: true }
      );
      const [version] = await database.adapter.select<{ id: string }>(
        VERSIONS_TABLE,
        {
          columns: ["id"],
          where: { and: [{ column: "entryId", op: "=", value: id }] },
          limit: 1,
        }
      );
      await database.adapter.update(
        VERSIONS_TABLE,
        { changedLocales: JSON.stringify(["fr-FR", "pt_BR"]) },
        { and: [{ column: "id", op: "=", value: version!.id }] }
      );

      expect(
        await refusalBeforeSchemaChanges(database.adapter, THREE)
      ).toBeUndefined();
      await migrateData(database.adapter as never, THREE);

      const [row] = await database.adapter.select<{ changedLocales: unknown }>(
        VERSIONS_TABLE,
        {
          columns: ["changedLocales"],
          where: { and: [{ column: "id", op: "=", value: version!.id }] },
        }
      );
      const list =
        typeof row?.changedLocales === "string"
          ? (JSON.parse(row.changedLocales) as unknown)
          : row?.changedLocales;
      expect(list).toEqual(["fr-FR", "pt-BR"]);
    });

    it("converts a stored spelling that mixes underscores and hyphens", async () => {
      const MIXED = siteWithLanguages(["en", "zh-Hant-TW"], "en");
      database = await openUpgradeDatabase(dialect);
      const t = await bootSite(database, "upgraded", MIXED);
      const created = await entriesOf(t).createEntry(
        { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
        {
          title: "hello",
          summary: "s",
          code: "code-mixed",
          status: "published",
        }
      );
      const id = (created.data as { id: string }).id;
      await entriesOf(t).updateEntry(
        {
          collectionName: ARTICLES,
          entryId: id,
          locale: "zh-Hant-TW",
          overrideAccess: true,
        },
        { title: "你好", status: "published", _overwrite: true }
      );
      await storeUnderCode(database, "zh-Hant-TW", "zh_Hant-TW");
      expect(await storedLanguages()).toEqual(["en", "zh_Hant-TW"]);

      await migrateData(database.adapter as never, MIXED);

      expect(await storedLanguages()).toEqual(["en", "zh-Hant-TW"]);
    });

    // MySQL compares codes without regard to letter case, so an older spelling stored in two
    // cases (`pt_BR` in the translations, `PT_br` in the archive) is one spelling there: one
    // conversion rewrites both. Broken, the two are taken for two spellings of one language kept
    // for the same thing, and the run is refused with no way to upgrade.
    it.runIf(dialect === "mysql")(
      "takes the cases of one older spelling as one on MySQL, which compares them alike",
      async () => {
        await legacyArticle();
        await ensureI18nArchive(database!.adapter as never, dialect);
        await database!.adapter.insert(
          "nextly_i18n_archive",
          {
            collection: ARTICLES,
            entityKind: "collection",
            entryId: "e-case",
            locale: "PT_br",
            field: "title",
            value: "olá",
            archivedAt: new Date("2026-08-01T10:00:00Z"),
          },
          { returning: [] }
        );

        expect(
          await refusalBeforeSchemaChanges(database!.adapter, STANDARD)
        ).toBeUndefined();
        await migrateData(database!.adapter as never, STANDARD);

        expect(await storedLanguages()).toEqual(["en", "pt-BR"]);
        const archived = await database!.adapter.select<{ locale: string }>(
          "nextly_i18n_archive",
          { columns: ["locale"] }
        );
        expect(archived.map(row => row.locale)).toEqual(["pt-BR"]);
      }
    );

    // The same on MySQL for the lists of codes the conversion rewrites: a version's changed
    // languages and a Settings language's fallback, each holding the other case of the spelling.
    // Broken, the list keeps `PT_br`, which the scan still finds, so the step never runs out of work.
    it.runIf(dialect === "mysql")(
      "rewrites the other case of one older spelling in lists of codes too, on MySQL",
      async () => {
        const id = await legacyArticle();
        // A published version: the steps after the codes' split and rewrite pending changes.
        const [version] = await database!.adapter.select<{ id: string }>(
          VERSIONS_TABLE,
          {
            columns: ["id"],
            where: {
              and: [
                { column: "entryId", op: "=", value: id },
                { column: "status", op: "=", value: "published" },
              ],
            },
            limit: 1,
          }
        );
        await database!.adapter.update(
          VERSIONS_TABLE,
          { changedLocales: JSON.stringify(["en", "PT_br"]) },
          { and: [{ column: "id", op: "=", value: version!.id }] }
        );
        const at = new Date("2026-08-01T10:00:00Z");
        await database!.adapter.insert(
          "nextly_languages",
          {
            code: "es",
            label: "es",
            direction: "ltr",
            fallback: JSON.stringify(["PT_br", "en"]),
            position: 2,
            isDefault: false,
            active: true,
            revision: 1,
            createdAt: at,
            updatedAt: at,
          },
          { returning: [] }
        );

        await migrateData(database!.adapter as never, STANDARD);

        const [row] = await database!.adapter.select<{
          changedLocales: unknown;
        }>(VERSIONS_TABLE, {
          columns: ["changedLocales"],
          where: { and: [{ column: "id", op: "=", value: version!.id }] },
        });
        const list =
          typeof row?.changedLocales === "string"
            ? (JSON.parse(row.changedLocales) as unknown)
            : row?.changedLocales;
        expect(list).toEqual(["en", "pt-BR"]);
        const [es] = await database!.adapter.select<{ fallback: string }>(
          "nextly_languages",
          {
            columns: ["fallback"],
            where: { and: [{ column: "code", op: "=", value: "es" }] },
          }
        );
        expect(JSON.parse(es!.fallback)).toEqual(["pt-BR", "en"]);
        // And the step has nothing left to do.
        expect(
          (await previewMigrateData(database!.adapter, STANDARD)).changes
        ).not.toContainEqual(expect.objectContaining({ action: "convert" }));
      }
    );

    // A site that manages its languages in Settings keeps them in `nextly_languages`, each with the
    // codes it falls back to. The upgrade converts that registry with the content, so the site's
    // next start names the language as its rows are stored.
    it("converts the Settings language registry with the content", async () => {
      await legacyArticle();
      const at = new Date("2026-08-01T10:00:00Z");
      const language = (
        code: string,
        position: number,
        fallback: string[]
      ) => ({
        code,
        label: code,
        direction: "ltr",
        fallback: JSON.stringify(fallback),
        position,
        isDefault: code === "en",
        active: true,
        revision: 1,
        createdAt: at,
        updatedAt: at,
      });
      for (const row of [
        language("en", 0, []),
        language("pt_BR", 1, ["en"]),
        language("es", 2, ["pt_BR", "en"]),
      ]) {
        await database!.adapter.insert("nextly_languages", row, {
          returning: [],
        });
      }
      const { localization: _configured, ...inSettings } = STANDARD;

      await migrateData(database!.adapter as never, inSettings as never);

      const registry = await database!.adapter.select<{
        code: string;
        fallback: string;
      }>("nextly_languages", { columns: ["code", "fallback"] });
      expect(registry.map(row => row.code).sort()).toEqual([
        "en",
        "es",
        "pt-BR",
      ]);
      expect(
        JSON.parse(registry.find(row => row.code === "es")!.fallback)
      ).toEqual(["pt-BR", "en"]);
      expect(await storedLanguages()).toEqual(["en", "pt-BR"]);
    });

    // Two spellings of one language can meet in a keyed table the translations never show: here
    // a base pinned for the same holder's pending change under each. Rewriting the older one would
    // give it the other's key, so the conversion stops before writing anything, translations
    // included, rather than stop part-way on the unique key.
    it("stops before writing anything where both spellings meet only in a keyed table", async () => {
      const id = await legacyArticle();
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: ARTICLES,
        entryId: id,
      };
      for (const code of ["pt_BR", "pt-BR"]) {
        const slot = `pending:${code}`;
        await database!.adapter.insert(
          "nextly_version_pins",
          {
            id: `pin-${code}`,
            ...ref,
            holder: "editor-1",
            slot,
            versionNo: 1,
            pinKey: versionPinKey(ref, "editor-1", slot),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { returning: [] }
        );
      }

      await expect(
        migrateData(database!.adapter as never, UNDERSCORED)
      ).rejects.toThrow(/pt_BR[\s\S]*pt-BR/);

      expect(await storedLanguages()).toEqual(["en", "pt_BR"]);
      expect(await pendingChanges(id)).toEqual([
        expect.objectContaining({ locale: "pt_BR" }),
      ]);
    });

    it("answers a request naming the old code with a deprecation, and one naming the standard code without", async () => {
      const id = await legacyArticle();
      await migrateData(database!.adapter as never, UNDERSCORED);
      await bootSite(database!, "upgraded", UNDERSCORED);
      const read = (locale: string) => {
        const url = new URL(
          `http://localhost/admin/api/collections/${ARTICLES}/entries/${id}?locale=${locale}`
        );
        return createDynamicHandlers().GET(
          new Request(url, { method: "GET", headers: { origin: url.origin } }),
          {
            params: Promise.resolve({
              params: ["collections", ARTICLES, "entries", id],
            }),
          }
        );
      };

      const older = await read("pt_BR");
      expect(older.headers.get("Deprecation")).toBe("true");
      expect(older.headers.get("Warning")).toMatch(/pt_BR[\s\S]*pt-BR/);
      expect((await read("pt-BR")).headers.get("Deprecation")).toBeNull();
    });

    /** A logger that keeps what the start warned. */
    function warningsKept(): {
      warnings: string[];
      logger: Parameters<typeof bootSite>[3];
    } {
      const warnings: string[] = [];
      const logger = {
        debug: () => undefined,
        info: () => undefined,
        warn: (message: string) => {
          warnings.push(message);
        },
        error: () => undefined,
      } as unknown as Parameters<typeof bootSite>[3];
      return { warnings, logger };
    }

    it("refuses to start while rows are under the older code, naming the upgrade", async () => {
      await legacyArticle();

      // The site would read Portuguese under `pt-BR` and find nothing.
      await expect(
        bootSite(database!, "legacy", UNDERSCORED, warningsKept().logger)
      ).rejects.toThrow(/pt_BR[\s\S]*nextly migrate/);
    });

    it("starts once upgraded, saying which code the configuration should name", async () => {
      await legacyArticle();
      await migrateData(database!.adapter as never, UNDERSCORED);
      const { warnings, logger } = warningsKept();

      await bootSite(database!, "upgraded", UNDERSCORED, logger);

      expect(warnings).toContainEqual(
        expect.stringMatching(/pt_BR[\s\S]*pt-BR/)
      );
    });
  }
);
