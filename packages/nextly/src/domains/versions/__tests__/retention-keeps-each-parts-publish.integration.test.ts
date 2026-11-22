/**
 * Retention keeps the latest published version of each language and of the
 * shared part, whatever the cap, judged by the parts each version records.
 *
 * Under per-language storage a publish of chosen parts, or of every language,
 * records no language in `locale`, so a rule keyed on `locale` sees all of
 * them as one key and keeps only the newest: publishing English alone, then
 * Spanish alone, then saving past the cap would remove English's latest
 * publish, the only copy of what its readers are served. Each case runs
 * through the real write paths at a small cap and, after every step, reads
 * `nextly_versions` back to check that each part's latest publish is there.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, number, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";

const POSTS = "partretention";
/** The cap: small, so a few saves push every earlier publish past it. */
const MAX_PER_DOC = 2;
/** The key the shared part is checked under, beside each language's code. */
const SHARED = "(shared)";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

async function boot(dialect: TestDialect): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    dialect,
    perLanguageStorage: true,
    collections: [
      defineCollection({
        slug: POSTS,
        localized: true,
        status: true,
        versions: { drafts: true, maxPerDoc: MAX_PER_DOC },
        // Translatable: `title`. Shared: `views`.
        fields: [text({ name: "title" }), number({ name: "views" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return (
    handle.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

/** Writes `data` to the entry in `locale`, as an editor's save does. */
async function save(
  entries: CollectionEntryService,
  id: string,
  locale: string,
  data: Record<string, unknown>
): Promise<void> {
  const saved = await entries.updateEntry(
    { collectionName: POSTS, entryId: id, overrideAccess: true, locale },
    { ...data, _overwrite: true }
  );
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

/** A document published in English and Spanish; answers its id. */
async function publishedInBoth(
  entries: CollectionEntryService
): Promise<string> {
  const created = await entries.createEntry(
    { collectionName: POSTS, overrideAccess: true, locale: "en" },
    { title: "en title", views: 10, status: "published" }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  const id = (created.data as { id: string }).id;
  await save(entries, id, "es", { title: "es title", status: "published" });
  return id;
}

async function publishParts(
  entries: CollectionEntryService,
  id: string,
  parts: { locales: string[]; shared?: boolean }
): Promise<void> {
  const published = await entries.publishParts(
    {
      collectionName: POSTS,
      entryId: id,
      overrideAccess: true,
      data: { _overwrite: true },
    },
    { direction: "publish", ...parts }
  );
  expect(published.success, JSON.stringify(published)).toBe(true);
}

async function publishAll(
  entries: CollectionEntryService,
  id: string
): Promise<void> {
  const published = await entries.publishAllLocales({
    data: { _overwrite: true },
    collectionName: POSTS,
    entryId: id,
    overrideAccess: true,
  });
  expect(published.success, JSON.stringify(published)).toBe(true);
}

type StoredRow = {
  versionNo: number | null;
  status: string;
  isAutosave: unknown;
  changedLocales?: unknown;
  sharedChanged?: unknown;
};

/** A durable version as read back: its number, status and the parts it names. */
interface Recorded {
  versionNo: number;
  published: boolean;
  parts: string[];
}

/**
 * The parts a stored row names, read as each dialect returns them (JSON text
 * or an array; a boolean or 0/1), as part keys: each language's code, and
 * `SHARED` for the shared part.
 */
function partsOf(row: StoredRow): string[] {
  const locales =
    typeof row.changedLocales === "string"
      ? (JSON.parse(row.changedLocales) as string[])
      : (row.changedLocales as string[] | null | undefined);
  const shared = row.sharedChanged === true || row.sharedChanged === 1;
  return [...[...(locales ?? [])].sort(), ...(shared ? [SHARED] : [])];
}

/** The entry's durable versions, as stored now. */
async function durableVersions(id: string): Promise<Recorded[]> {
  const rows = await handle!.adapter.select<StoredRow>("nextly_versions", {
    where: { and: [{ column: "entryId", op: "=", value: id }] },
  });
  return rows
    .filter(row => typeof row.versionNo === "number" && !row.isAutosave)
    .map(row => ({
      versionNo: Number(row.versionNo),
      published: row.status === "published",
      parts: partsOf(row),
    }));
}

/**
 * Every durable version the test has seen, kept after retention removes it,
 * so the latest publish of each part is known even once it is gone.
 */
class History {
  private readonly seen = new Map<number, Recorded>();

  /**
   * Reads the stored versions, notes them, and checks that the latest
   * published version of each of `parts` is still stored. Answers the
   * stored version numbers.
   */
  async expectEachPartsLatestPublishKept(
    id: string,
    parts: readonly string[] = ["en", "es", SHARED]
  ): Promise<number[]> {
    const stored = await durableVersions(id);
    for (const version of stored) this.seen.set(version.versionNo, version);
    const storedNos = stored.map(version => version.versionNo);
    for (const part of parts) {
      const latest = Math.max(
        ...[...this.seen.values()]
          .filter(v => v.published && v.parts.includes(part))
          .map(v => v.versionNo)
      );
      expect(latest, `a publish of ${part} was recorded`).toBeGreaterThan(0);
      expect(storedNos, `${part}'s latest publish, v${latest}`).toContain(
        latest
      );
    }
    return storedNos;
  }

  /** The newest version seen, with the parts it names. */
  newest(): Recorded {
    return [...this.seen.values()].sort((a, b) => b.versionNo - a.versionNo)[0];
  }
}

describe.each(getConfiguredTestDialects())(
  "retention keeps each part's latest publish (%s)",
  dialect => {
    it("keeps English's publish after Spanish is published alone and saves pass the cap", async () => {
      const entries = await boot(dialect);
      const history = new History();
      const id = await publishedInBoth(entries);
      await history.expectEachPartsLatestPublishKept(id);

      await save(entries, id, "en", { title: "en 2" });
      await publishParts(entries, id, { locales: ["en"] });
      await history.expectEachPartsLatestPublishKept(id);
      const english = history.newest();
      expect(english).toMatchObject({ published: true, parts: ["en"] });

      await save(entries, id, "es", { title: "es 2" });
      await publishParts(entries, id, { locales: ["es"] });
      await history.expectEachPartsLatestPublishKept(id);
      expect(history.newest()).toMatchObject({
        published: true,
        parts: ["es"],
      });

      for (const n of [3, 4, 5, 6]) {
        await save(entries, id, "en", { title: `en ${n}` });
        const stored = await history.expectEachPartsLatestPublishKept(id);
        expect(stored).toContain(english.versionNo);
      }
    }, 120_000);

    it("keeps a publish of the shared part alone through publishes of each language", async () => {
      const entries = await boot(dialect);
      const history = new History();
      const id = await publishedInBoth(entries);

      await save(entries, id, "es", { views: 40 });
      await publishParts(entries, id, { locales: [], shared: true });
      await history.expectEachPartsLatestPublishKept(id);
      const shared = history.newest();
      expect(shared).toMatchObject({ published: true, parts: [SHARED] });

      for (const n of [2, 3]) {
        for (const locale of ["en", "es"]) {
          await save(entries, id, locale, { title: `${locale} ${n}` });
          await publishParts(entries, id, { locales: [locale] });
          const stored = await history.expectEachPartsLatestPublishKept(id);
          expect(stored).toContain(shared.versionNo);
        }
      }
    }, 120_000);

    it("keeps a publish of every language and the shared part for each part another publish has not replaced", async () => {
      const entries = await boot(dialect);
      const history = new History();
      const id = await publishedInBoth(entries);

      await save(entries, id, "en", { title: "en 2" });
      await save(entries, id, "es", { title: "es 2", views: 60 });
      await publishAll(entries, id);
      await history.expectEachPartsLatestPublishKept(id);
      const all = history.newest();
      expect(all).toMatchObject({
        published: true,
        parts: ["en", "es", SHARED],
      });

      // English is published again and again; Spanish and the shared part
      // were last published by the publish of everything.
      for (const n of [3, 4, 5]) {
        await save(entries, id, "en", { title: `en ${n}` });
        await publishParts(entries, id, { locales: ["en"] });
        const stored = await history.expectEachPartsLatestPublishKept(id);
        expect(stored).toContain(all.versionNo);
      }
    }, 120_000);
  }
);
