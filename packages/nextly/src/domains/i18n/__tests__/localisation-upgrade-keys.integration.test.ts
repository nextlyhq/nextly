/**
 * `nextly migrate`'s data steps give every pending change its key: a working draft stored before pending
 * changes were keyed (`draft_key` NULL) gets the key its document and language make, and where a
 * document holds two drafts for one language the later save is kept, the earlier one listed for an
 * editor. Afterwards the count of pending changes in a language agrees with the drafts there.
 *
 * The plausible broken upgrades: one that keys the first draft it finds, keeping an earlier save
 * over a later one; one that keys every duplicate, which the unique key refuses; and one that
 * leaves keyless drafts, which the count of pending changes does not see.
 */
import { sql } from "drizzle-orm";
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
  refusalBeforeSchemaChanges,
  SITE,
  type UpgradeDatabase,
} from "./helpers/localisation-upgrade-fixture";
import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";

// Written for per-language storage as every installation runs it (`storage-layout`).
perLanguageStorageSuite();

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
      savedAt: Date,
      /** A change to the article's shared `code` the draft carries too. */
      code?: string
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
          snapshot: JSON.stringify({
            title,
            summary: "s",
            ...(code === undefined ? {} : { code }),
          }),
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

    it("refuses two saves of one language at the same moment, naming them, and keeps both", async () => {
      database = await openUpgradeDatabase(dialect);
      const t = await bootSite(database, "legacy");
      const created = await entriesOf(t).createEntry(
        { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
        { title: "hello", summary: "s", code: "code-1", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const at = new Date("2026-08-01T10:00:00Z");
      await storeKeylessDraft(id, "es", "hola, one", at);
      await storeKeylessDraft(id, "es", "hola, two", at);

      await expect(
        migrateData(database.adapter as never, SITE)
      ).rejects.toThrow(/same moment[\s\S]*nextly migrate/);
      expect(
        (await draftsOf(id)).filter(row => row.locale === "es")
      ).toHaveLength(2);
    });

    // `nextly migrate` asks its steps for a refusal before its schema changes, but a step reads what
    // the steps before it repair, so its count waits for them. Here the earlier Spanish save shares
    // its moment with the French one and changes the shared code differently, which, counted
    // against the database as it stands, is a tie the draft split refuses. Keying first lets the
    // earlier Spanish save go, so the run has no tie. Broken, the run is refused up front.
    it("refuses nothing up front that keying the pending changes settles first", async () => {
      database = await openUpgradeDatabase(dialect);
      const t = await bootSite(database, "legacy");
      const created = await entriesOf(t).createEntry(
        { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
        { title: "hello", summary: "s", code: "code-1", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const moment = new Date("2026-08-01T10:00:00Z");
      await storeKeylessDraft(id, "es", "hola, earlier", moment, "code-es");
      await storeKeylessDraft(
        id,
        "es",
        "hola, later",
        new Date("2026-08-02T10:00:00Z")
      );
      await storeKeylessDraft(id, "fr", "bonjour", moment, "code-fr");

      expect(
        await refusalBeforeSchemaChanges(database.adapter, SITE)
      ).toBeUndefined();
      expect(
        (await previewMigrateData(database.adapter, SITE)).refusals ?? []
      ).toEqual([]);
      // The run itself has no tie: the earlier Spanish save is let go before the split, which
      // keeps the later one (and moves the French change to the shared code into the shared part).
      await migrateData(database.adapter, SITE);
      const spanish = (await draftsOf(id)).filter(row => row.locale === "es");
      expect(spanish).toHaveLength(1);
      expect(JSON.stringify(spanish[0]?.snapshot)).toContain("hola, later");
    });

    // A refusal that depends on an earlier repair step is made in order, after that step (and, in
    // `nextly migrate`, after the schema changes), which stay applied. Here keying has work on one
    // article, and another holds a real tie that keying does not settle: the draft split refuses
    // it in the run. The dry run names that refusal as one the run may make; the run's refusal
    // says what applied, never "Nothing was changed"; and once the cause is fixed, the next run
    // carries on from the keyed drafts and completes. Broken, the refusal claims nothing changed,
    // or the dry run is silent, or the second run trips over what the first one applied.
    it("refuses a tie keying does not settle after keying, saying so, and completes once it is fixed", async () => {
      database = await openUpgradeDatabase(dialect);
      const t = await bootSite(database, "legacy");
      const article = async (code: string) =>
        (
          (
            await entriesOf(t).createEntry(
              { collectionName: ARTICLES, overrideAccess: true, locale: "en" },
              { title: "hello", summary: "s", code, status: "published" }
            )
          ).data as { id: string }
        ).id;
      const keyed = await article("code-keyed");
      const tied = await article("code-tied");
      const moment = new Date("2026-08-01T10:00:00Z");
      // Keying's work: two Spanish saves of one article, the earlier of which it lets go.
      await storeKeylessDraft(keyed, "es", "hola, earlier", moment);
      await storeKeylessDraft(
        keyed,
        "es",
        "hola, later",
        new Date("2026-08-02T10:00:00Z")
      );
      // A real tie: Spanish and French changed the shared code differently at one moment.
      await storeKeylessDraft(tied, "es", "hola", moment, "code-es");
      await storeKeylessDraft(tied, "fr", "bonjour", moment, "code-fr");

      expect(
        await refusalBeforeSchemaChanges(database.adapter, SITE)
      ).toBeUndefined();
      expect(
        (await previewMigrateData(database.adapter, SITE)).notes
      ).toContainEqual(
        expect.stringContaining(
          'may be refused once "give every pending change its key" has run'
        )
      );

      const refusal = await migrateData(database.adapter, SITE).then(
        () => undefined,
        (error: unknown) => error
      );
      const message = (refusal as { publicMessage?: string }).publicMessage;
      expect(message).toMatch(new RegExp(`${tied}[\\s\\S]*code`));
      expect(message).toContain('the step "give every pending change its key"');
      expect(message).toContain("stay applied");
      expect(message).not.toContain("Nothing was changed");
      // What keying applied stays: the earlier Spanish save let go, the later one keyed.
      const titleOf = (row: DraftRow): unknown => {
        const snapshot: unknown =
          typeof row.snapshot === "string"
            ? JSON.parse(row.snapshot)
            : row.snapshot;
        return (snapshot as { title?: unknown }).title;
      };
      expect((await draftsOf(keyed)).map(titleOf)).toEqual(["hola, later"]);
      // The tied article's two changes are as they were.
      expect((await draftsOf(tied)).map(row => row.locale).sort()).toEqual([
        "es",
        "fr",
      ]);

      // The cause fixed as the refusal says: the French change saved later.
      const later = new Date("2026-08-03T10:00:00Z");
      await database.adapter.update(
        VERSIONS_TABLE,
        { createdAt: later, updatedAt: later },
        {
          and: [
            { column: "entryId", op: "=", value: tied },
            { column: "locale", op: "=", value: "fr" },
          ],
        }
      );
      await migrateData(database.adapter, SITE);
      expect(
        await refusalBeforeSchemaChanges(database.adapter, SITE)
      ).toBeUndefined();
      expect(
        (await previewMigrateData(database.adapter, SITE)).changes
      ).toEqual([]);
    });

    it("refuses pending changes in a version history laid out by an earlier release", async () => {
      const id = await legacyArticle();
      // The version history as an earlier release laid it out: without the column recording which
      // parts each version changed.
      const drop = sql`ALTER TABLE ${sql.identifier(VERSIONS_TABLE)} DROP COLUMN ${sql.identifier("changed_locales")}`;
      if (dialect === "sqlite") {
        database!.adapter.getDrizzle<{ run(q: unknown): unknown }>().run(drop);
      } else {
        await database!.adapter
          .getDrizzle<{ execute(q: unknown): Promise<unknown> }>()
          .execute(drop);
      }

      await expect(
        migrateData(database!.adapter as never, SITE)
      ).rejects.toThrow(/changed_locales[\s\S]*nextly migrate/);
      expect(id).toBeTruthy();
    });
  }
);
