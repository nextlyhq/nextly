/**
 * `nextly migrate`'s data steps refuse, naming the one-time recovery, where it cannot tell which copy of a
 * translated entity's values is current: its translations table is there, its main table still
 * holds the translatable columns, and no record says whether the values were ever copied across
 * (an `untracked` transition). `nextly migrate --repair-localization` supplies the one missing fact,
 * and the upgrade changes nothing until it has run.
 *
 * The plausible broken upgrade moves the main table's values anyway: it either overwrites the
 * translations with older values, or drops the main table's columns before they were copied.
 */
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import type { TestNextly } from "../../../plugins/test-nextly";
import { introspectLiveColumns } from "../../schema/pipeline/diff/introspect-live";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { _resetPerLanguageStorage } from "../per-language-storage";

import {
  ARTICLES,
  bootSite,
  migrateData,
  openUpgradeDatabase,
  previewMigrateData,
  SITE,
  type UpgradeDatabase,
} from "./helpers/localisation-upgrade-fixture";

describeEachDialect(
  "upgrading a translated entity with no transition record",
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

    /** The columns `dc_articles` has. */
    async function mainColumns(): Promise<string[]> {
      const { tables } = await introspectLiveColumns(
        database!.adapter.getDrizzle(),
        database!.adapter.dialect,
        ["dc_articles"]
      );
      return (tables[0]?.columns ?? []).map(column => column.name);
    }

    /**
     * A translated article whose main table still holds a translatable column beside its
     * translations table, with no record of a transition: as an installation translated before
     * transitions were recorded, whose copy across nothing describes. The column is added by
     * statement, since no release lays a table out so any longer.
     */
    async function untrackedArticles(): Promise<void> {
      database = await openUpgradeDatabase(dialect);
      const t = await bootSite(database, "legacy");
      await entriesOf(t).createEntry(
        { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
        { title: "hello", summary: "s", code: "code-1", status: "published" }
      );
      const add = sql`ALTER TABLE ${sql.identifier("dc_articles")} ADD COLUMN ${sql.identifier("title")} ${sql.raw(dialect === "mysql" ? "VARCHAR(255)" : "TEXT")}`;
      if (dialect === "sqlite") {
        database.adapter.getDrizzle<{ run(q: unknown): unknown }>().run(add);
      } else {
        await database.adapter
          .getDrizzle<{ execute(q: unknown): Promise<unknown> }>()
          .execute(add);
      }
    }

    it("refuses, naming the recovery, in a dry run and a real run, and changes nothing", async () => {
      await untrackedArticles();
      const deps = { adapter: database!.adapter as never, config: SITE };

      const plan = await previewMigrateData(deps.adapter, deps.config);
      expect(plan.refusals).toContainEqual(
        expect.stringMatching(/articles[\s\S]*--repair-localization/)
      );

      await expect(migrateData(deps.adapter, deps.config)).rejects.toThrow(
        /--repair-localization/
      );
      expect(await mainColumns()).toContain("title");
    });
  }
);
