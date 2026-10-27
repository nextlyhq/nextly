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

async function boot(dialect: TestDialect): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
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
 * Returns the ids in creation order and the Spanish instants AS STORED —
 * read back after the write, so the cases below filter on the values the
 * database actually holds (on a host whose zone is not UTC a companion
 * write stores a shifted wall clock; that write-side behaviour is a
 * separate defect, and these cases must not depend on it either way).
 */
async function seedThree(entries: CollectionEntryService): Promise<{
  ids: string[];
  storedEs: Record<string, string>;
}> {
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
  const all = await entries.listEntries({
    collectionName: COLLECTION,
    locale: "es",
    overrideAccess: true,
    limit: 10,
  });
  const storedEs: Record<string, string> = {};
  for (const doc of (
    all.data as { docs: Array<{ id: string; happensAt: unknown }> }
  ).docs) {
    // The instant as the reader spells it (ISO, whole milliseconds), so the
    // bounds below are values the strict operand reader accepts on every
    // dialect.
    storedEs[doc.id] = new Date(String(doc.happensAt)).toISOString();
  }
  return { ids: created, storedEs };
}

async function listIds(
  entries: CollectionEntryService,
  where: WhereFilter,
  locale?: string
): Promise<string[]> {
  const res = await entries.listEntries({
    collectionName: COLLECTION,
    where,
    locale,
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

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  describe("a filter on a localized date field, on a non-default locale", () => {
    it("greater_than returns exactly the entries whose translation is later", async () => {
      const entries = await boot(dialect);
      const { ids, storedEs } = await seedThree(entries);
      // The smallest stored Spanish instant: strictly later holds the rest.
      const smallest = ids.reduce((a, b) =>
        storedEs[a] <= storedEs[b] ? a : b
      );
      const bound = storedEs[smallest];

      const matched = await listIds(
        entries,
        {
          happensAt: { greater_than: bound },
        },
        "es"
      );
      expect(matched).toEqual(ids.filter(id => id !== smallest).sort());
    });

    it("equality returns exactly the entry whose translation is that instant", async () => {
      const entries = await boot(dialect);
      const { ids, storedEs } = await seedThree(entries);
      const target = ids.find(id => storedEs[id] === storedEs[ids[0]])!;

      const matched = await listIds(
        entries,
        {
          happensAt: { equals: storedEs[target] },
        },
        "es"
      );
      expect(matched).toEqual([target]);
    });

    it("a range returns exactly the entries between the bounds", async () => {
      const entries = await boot(dialect);
      const { ids, storedEs } = await seedThree(entries);
      const order = [...ids].sort((a, b) =>
        storedEs[a] <= storedEs[b] ? -1 : 1
      );
      const low = order[0];
      const middle = order[1];
      const high = order[2];

      const matched = await listIds(
        entries,
        {
          happensAt: {
            greater_than: storedEs[low],
            less_than: storedEs[high],
          },
        },
        "es"
      );
      expect(matched).toEqual([middle]);
    });

    it("a bound between two stored instants separates exactly those rows", async () => {
      // The bound must sit strictly between two stored instants: everything
      // above it matches, everything below does not. A raw string bound
      // fails this on MySQL, whose coercion of a `Z`-suffixed operand
      // answers for rows the instant does not name.
      const entries = await boot(dialect);
      const rows = [
        { title: "inside", at: "2026-01-19T03:00:00Z" },
        { title: "below", at: "2026-01-19T00:00:00Z" },
        { title: "above", at: "2026-01-20T07:00:00Z" },
      ];
      const created: string[] = [];
      for (const row of rows) {
        const res = await entries.createEntry(
          { collectionName: COLLECTION, overrideAccess: true, locale: "es" },
          { title: row.title, happensAt: row.at }
        );
        if (!res.data) {
          throw new Error(
            `createEntry refused: ${res.statusCode} ${JSON.stringify(res.message)}`
          );
        }
        created.push((res.data as { id: string }).id);
      }
      const all = await entries.listEntries({
        collectionName: COLLECTION,
        locale: "es",
        overrideAccess: true,
        limit: 10,
      });
      const stored: Record<string, string> = {};
      for (const doc of (
        all.data as { docs: Array<{ id: string; happensAt: unknown }> }
      ).docs) {
        stored[doc.id] = new Date(String(doc.happensAt)).toISOString();
      }
      const below = created[1];

      const matched = await listIds(
        entries,
        {
          happensAt: { greater_than: stored[below] },
        },
        "es"
      );
      expect(matched).toEqual(created.filter(id => id !== below).sort());
    });

    it("an operand no date can read is refused, not sent to the database", async () => {
      const entries = await boot(dialect);
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

  describe("bulk delete by a localized date filter", () => {
    it("removes exactly the matching entries", async () => {
      const entries = await boot(dialect);
      const created: string[] = [];
      const dates = [D1, D2, D3];
      for (const [index, at] of dates.entries()) {
        const res = await entries.createEntry(
          { collectionName: COLLECTION, overrideAccess: true },
          { title: `bulk-${index}`, happensAt: at }
        );
        if (!res.data) {
          throw new Error(
            `createEntry refused: ${res.statusCode} ${JSON.stringify(res.message)}`
          );
        }
        created.push((res.data as { id: string }).id);
      }
      // The delete takes no locale, so it enumerates in the read's default
      // language; the target instant is read back from that same store, so
      // the delete holds exactly the rows a list read names.
      const all = await entries.listEntries({
        collectionName: COLLECTION,
        overrideAccess: true,
        limit: 10,
      });
      const stored: Record<string, string> = {};
      for (const doc of (
        all.data as { docs: Array<{ id: string; happensAt: unknown }> }
      ).docs) {
        stored[doc.id] = new Date(String(doc.happensAt)).toISOString();
      }
      const target = created[1];

      await entries.bulkDeleteByQuery({
        collectionName: COLLECTION,
        where: { happensAt: { equals: stored[target] } },
        overrideAccess: true,
      });

      const survivors = created.filter(id => id !== target).sort();
      const remaining = await listIds(entries, {}, "en");
      expect(remaining).toEqual(survivors);
    });
  });
});
