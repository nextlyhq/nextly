/**
 * `nextly upgrade` brings a language code that is not in BCP 47 form (`pt_BR`) to its standard
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

import { previewUpgrade, runUpgrade } from "../../../cli/commands/upgrade";
import { UPGRADE_STEPS } from "../../../cli/commands/upgrade-steps";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import type { TestNextly } from "../../../plugins/test-nextly";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { workingDraftKey } from "../../versions/working-draft-key";
import {
  WORKING_DRAFT_SHAPE,
  type VersionRow,
} from "../../versions/versions-repository";
import { _resetPerLanguageStorage } from "../per-language-storage";

import {
  ARTICLES,
  bootSite,
  openUpgradeDatabase,
  siteWithLanguages,
  storeUnderCode,
  type UpgradeDatabase,
} from "./helpers/localisation-upgrade-fixture";

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
      await runUpgrade(
        { confirmBackedUp: true },
        {
          adapter: database!.adapter as never,
          config: UNDERSCORED,
          steps: UPGRADE_STEPS.filter(step =>
            step.title.startsWith("convert language codes")
          ),
        }
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

    it("serves the old code as the standard one once upgraded", async () => {
      const id = await legacyArticle();
      await runUpgrade(
        { confirmBackedUp: true },
        { adapter: database!.adapter as never, config: UNDERSCORED }
      );

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

    it("lists each conversion in a dry run", async () => {
      await legacyArticle();

      const plan = await previewUpgrade(
        { confirmBackedUp: true },
        { adapter: database!.adapter as never, config: UNDERSCORED }
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

      const plan = await previewUpgrade({ confirmBackedUp: true }, deps);
      expect(plan.refusals).toEqual([
        expect.stringMatching(/pt_BR.*pt-BR|pt-BR.*pt_BR/),
      ]);

      await expect(runUpgrade({ confirmBackedUp: true }, deps)).rejects.toThrow(
        /pt_BR.*pt-BR|pt-BR.*pt_BR/
      );
      expect(await storedLanguages()).toEqual(["en", "pt_BR"]);
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
      ).rejects.toThrow(/pt_BR[\s\S]*nextly upgrade/);
    });

    it("starts once upgraded, saying which code the configuration should name", async () => {
      await legacyArticle();
      await runUpgrade(
        { confirmBackedUp: true },
        { adapter: database!.adapter as never, config: UNDERSCORED }
      );
      const { warnings, logger } = warningsKept();

      await bootSite(database!, "upgraded", UNDERSCORED, logger);

      expect(warnings).toContainEqual(
        expect.stringMatching(/pt_BR[\s\S]*pt-BR/)
      );
    });
  }
);
