/**
 * A localized date filter compares as the instant it names.
 *
 * A filter on a NON-DEFAULT locale resolves through the companion EXISTS
 * built by `buildLocalizedWhereExists`, which binds the operand raw into
 * raw `sql`. On SQLite the companion date column is an integer epoch
 * (seconds), so `epoch > '2026-01-20T…'` compares an INTEGER with a TEXT
 * parameter and SQLite's type ordering — numbers before text — answers
 * instead of time: a "later than" filter matches nothing it should match,
 * and a bulk delete by such a filter removes documents the filter names
 * not at all. Postgres and MySQL coerce the string, which answers right by
 * their own coercion rather than by a shared rule, so each case below
 * holds the result against exactly the entries the operand names in the
 * locale it filters, on every dialect.
 *
 * Every case filters a NON-DEFAULT locale: a default-locale read compares
 * on the main table, whose date columns already bind through the same
 * operand reader the main where builder uses.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, date, text } from "../../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { WhereFilter } from "../../../../domains/collections/query/query-operators";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const COLLECTION = "dateposts";
const D1 = "2026-01-10T09:00:00Z";
const D2 = "2026-01-20T09:00:00Z";
const D3 = "2026-01-30T09:00:00Z";

async function boot(): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    collections: [
      defineCollection({
        slug: COLLECTION,
        localized: true,
        fields: [
          date({ name: "happensAt", localized: true }),
          text({ name: "title" }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return (
    handle.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

/**
 * Seed three entries whose English dates sit at D1, D2, D3 and whose
 * Spanish dates are ROTATED (D2, D3, D1), so an answer filtered on `es`
 * cannot come from the English values: the locales must disagree.
 * Returns the ids in creation order.
 */
async function seedThree(entries: CollectionEntryService): Promise<string[]> {
  const seeded: Array<{ en: string; es: string }> = [
    { en: D1, es: D2 },
    { en: D2, es: D3 },
    { en: D3, es: D1 },
  ];
  const created: string[] = [];
  for (const [index, dates] of seeded.entries()) {
    const res = await entries.createEntry(
      {
        collectionName: COLLECTION,
        overrideAccess: true,
        locale: "en",
      },
      { title: `first-${index}`, happensAt: dates.en }
    );
    // A refused write answers data: null with the reason beside it; the
    // suite cannot hold any expectation on a row that never existed.
    if (!res.data) {
      throw new Error(
        `createEntry refused: ${res.statusCode} ${JSON.stringify(res.message)}`
      );
    }
    const id = (res.data as { id: string }).id;
    await entries.updateEntry(
      {
        collectionName: COLLECTION,
        entryId: id,
        overrideAccess: true,
        locale: "es",
      },
      { happensAt: dates.es }
    );
    created.push(id);
  }
  return created;
}

async function listIds(
  entries: CollectionEntryService,
  where: WhereFilter
): Promise<string[]> {
  const res = await entries.listEntries({
    collectionName: COLLECTION,
    where,
    locale: "es",
    overrideAccess: true,
    limit: 10,
  });
  // A refused filter answers data: null; the suite must see the refusal,
  // not a diff against rows that were never read.
  if (!res.data) {
    throw new Error(
      `listEntries refused: ${res.statusCode} ${JSON.stringify(res.message)}`
    );
  }
  const docs = (res.data as { docs: Array<{ id: string }> }).docs;
  return docs.map(i => i.id).sort();
}

describe.each(getConfiguredTestDialects())("on %s", () => {
  describe("a filter on a localized date field, on a non-default locale", () => {
    it("greater_than returns exactly the entries whose translation is later", async () => {
      const entries = await boot();
      const [id1, id2, id3] = await seedThree(entries);

      // Spanish dates: id1=D2, id2=D3, id3=D1. Later than D1: id1 and id2.
      const ids = await listIds(entries, {
        happensAt: { greater_than: D1 },
      });
      expect(ids).toEqual([id1, id2].sort());
    });

    it("equality returns exactly the entry whose translation is that instant", async () => {
      const entries = await boot();
      const [id1, , id3] = await seedThree(entries);

      // Spanish dates: only id3 holds D1.
      const ids = await listIds(entries, {
        happensAt: { equals: D1 },
      });
      expect(ids).toEqual([id3]);
    });

    it("a range returns exactly the entries between the bounds", async () => {
      const entries = await boot();
      const [id1, id2] = await seedThree(entries);

      // Spanish dates sit at D2, D3, D1: only id1=D2 lies between the bounds.
      const ids = await listIds(entries, {
        happensAt: { greater_than: D1, less_than: D3 },
      });
      expect(ids).toEqual([id1]);
    });

    it("an operand no date can read is refused, not sent to the database", async () => {
      const entries = await boot();
      await seedThree(entries);

      const res = await entries.listEntries({
        collectionName: COLLECTION,
        where: { happensAt: { greater_than: "not-a-date" } },
        locale: "es",
        overrideAccess: true,
        limit: 10,
      });
      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(400);
    });
  });

  describe("bulk delete by a localized date filter, on a non-default locale", () => {
    it("removes exactly the matching entries", async () => {
      const entries = await boot();
      const [id1, id2] = await seedThree(entries);

      // A bulk delete by query takes no locale, so it enumerates in the
      // read's default language: the English dates D1, D2, D3 sit at
      // id1, id2, id3, and later than D2 is id3 alone.
      await entries.bulkDeleteByQuery({
        collectionName: COLLECTION,
        where: { happensAt: { greater_than: D2 } },
        overrideAccess: true,
      });

      const survivors = await listIds(entries, {});
      expect(survivors).toEqual([id1, id2].sort());
    });
  });
});
