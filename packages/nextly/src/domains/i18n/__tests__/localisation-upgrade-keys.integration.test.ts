/**
 * `nextly upgrade` gives every pending change its key: a working draft stored before pending
 * changes were keyed (`draft_key` NULL) gets the key its document and language make, and where a
 * document holds two drafts for one language the later save is kept, the earlier one listed for an
 * editor. Afterwards the count of pending changes in a language agrees with the drafts there.
 *
 * The plausible broken upgrades: one that keys the first draft it finds, keeping an earlier save
 * over a later one; one that keys every duplicate, which the unique key refuses; and one that
 * leaves keyless drafts, which the count of pending changes does not see.
 */
import { afterEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import type { TestNextly } from "../../../plugins/test-nextly";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import type { CollectionsHandler } from "../../../services/collections-handler";
import {
  WORKING_DRAFT_SHAPE,
  type VersionRow,
} from "../../versions/versions-repository";
import { workingDraftKey } from "../../versions/working-draft-key";
import { pendingChangesIn } from "../default-language-change";
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
  "upgrading pending changes stored without a key",
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

    type DraftRow = VersionRow & { draftKey: string | null };

    /** The article's working drafts, by language. */
    async function draftsOf(id: string): Promise<DraftRow[]> {
      return database!.adapter.select<DraftRow>(VERSIONS_TABLE, {
        where: {
          and: [
            { column: "entryId", op: "=", value: id },
            ...WORKING_DRAFT_SHAPE,
          ],
        },
      });
    }

    /**
     * A working draft of the article stored as a release from before pending changes were keyed
     * stored one: no key, saved at `savedAt`. It holds its language's values alone, the shape a
     * draft is kept in by part, so the key is the only thing the upgrade has to give it.
     */
    async function storeKeylessDraft(
      id: string,
      locale: string,
      title: string,
      savedAt: Date
    ): Promise<void> {
      await database!.adapter.insert(
        VERSIONS_TABLE,
        {
          id: crypto.randomUUID(),
          scopeKind: "collection",
          scopeSlug: ARTICLES,
          entryId: id,
          versionNo: null,
          status: "draft",
          isAutosave: false,
          snapshot: JSON.stringify({ title, summary: "s" }),
          label: null,
          locale,
          draftKey: null,
          sourceVersionNo: null,
          createdBy: null,
          createdAt: savedAt,
          updatedAt: savedAt,
        },
        { returning: [] }
      );
    }

    /**
     * One article live in English and Spanish, holding three pending changes stored without a key:
     * two in Spanish, an earlier and a later save, and one in French.
     */
    async function legacyArticle(): Promise<string> {
      database = await openUpgradeDatabase(dialect);
      const t = await bootSite(database, "legacy");
      const entries = entriesOf(t);
      const created = await entries.createEntry(
        { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
        { title: "hello", summary: "s", code: "code-1", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      await entries.updateEntry(
        {
          collectionName: ARTICLES,
          entryId: id,
          locale: "es",
          overrideAccess: true,
        },
        { title: "hola", status: "published", _overwrite: true }
      );
      await storeKeylessDraft(
        id,
        "es",
        "hola, earlier",
        new Date("2026-08-01T10:00:00Z")
      );
      await storeKeylessDraft(
        id,
        "es",
        "hola, later",
        new Date("2026-08-02T10:00:00Z")
      );
      await storeKeylessDraft(
        id,
        "fr",
        "bonjour",
        new Date("2026-08-01T10:00:00Z")
      );
      return id;
    }

    it("keys each pending change, keeping the later of two saves in one language", async () => {
      const id = await legacyArticle();

      await migrateData(database!.adapter as never, SITE);

      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: ARTICLES,
        entryId: id,
      };
      const drafts = await draftsOf(id);
      const byLanguage = (locale: string) =>
        drafts.filter(row => row.locale === locale);
      expect(byLanguage("es")).toHaveLength(1);
      expect(byLanguage("es")[0]!.draftKey).toBe(workingDraftKey(ref, "es"));
      expect(JSON.stringify(byLanguage("es")[0]!.snapshot)).toMatch(
        /hola, later/
      );
      expect(byLanguage("fr")).toHaveLength(1);
      expect(byLanguage("fr")[0]!.draftKey).toBe(workingDraftKey(ref, "fr"));
      // The count of pending changes sees every one of them.
      expect(await pendingChangesIn(database!.adapter, "es")).toBe(1);
      expect(await pendingChangesIn(database!.adapter, "fr")).toBe(1);
    });

    it("lists the earlier save it lets go, for an editor to check", async () => {
      const id = await legacyArticle();

      const plan = await previewMigrateData(database!.adapter as never, SITE);

      expect(plan.report?.check).toContainEqual(
        expect.stringMatching(
          new RegExp(`${ARTICLES}[\\s\\S]*${id}[\\s\\S]*es`)
        )
      );
      // Nothing changed.
      expect((await draftsOf(id)).every(row => row.draftKey === null)).toBe(
        true
      );
    });
  }
);
