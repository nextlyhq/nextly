/**
 * The collection row cache on every dialect, on the read benchmark's site:
 *
 * - reads are the same with the cache warm as with it cold;
 * - a warm read sends the database 4 statements for an entry and 5 for a page,
 *   where the same read without the cache sends 11 and 13;
 * - every registry write a registry service makes is seen at once;
 * - a change made elsewhere is seen once the cached row's second is up, and
 *   not before;
 * - a read inside a transaction never comes from the cache.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// The cache as it is, with a switch that sends every read past it: the reads
// as they were before it, for the statement count to compare against.
const bypass = vi.hoisted(() => ({ on: false }));
vi.mock("../services/collection-row-cache", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../services/collection-row-cache")>();
  return {
    ...actual,
    cachedCollectionRow: (
      database: object,
      slug: string,
      read: () => Promise<Record<string, unknown>>
    ) =>
      bypass.on ? read() : actual.cachedCollectionRow(database, slug, read),
  };
});

import {
  checkbox,
  date,
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  number,
  relationship,
  text,
  textarea,
} from "../../../config";
import { statementsOf } from "../../../database/__tests__/integration/helpers/count-statements";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { consoleLogger } from "../../../shared/types";
import {
  clearCollectionRowCache,
  COLLECTION_ROW_LIFETIME_MS,
} from "../services/collection-row-cache";
import {
  DynamicCollectionRegistryService,
  type CollectionMetadata,
} from "../services/dynamic-collection-registry-service";

let current: TestNextly | undefined;

afterEach(async () => {
  bypass.on = false;
  vi.useRealTimers();
  await current?.destroy();
  current = undefined;
});

const publicRead = { read: () => true };

/** The read benchmark's site, as a single-language site stores it today. */
async function bootSite(dialect: TestDialect): Promise<{
  t: TestNextly;
  articleId: string;
}> {
  const t = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: "card",
        fields: [text({ name: "heading" }), textarea({ name: "blurb" })],
      }),
    ],
    collections: [
      defineCollection({
        slug: "authors",
        access: publicRead,
        fields: [text({ name: "name" }), textarea({ name: "bio" })],
      }),
      defineCollection({
        slug: "articles",
        access: publicRead,
        fields: [
          text({ name: "headline" }),
          textarea({ name: "excerpt" }),
          number({ name: "views" }),
          date({ name: "publishedOn" }),
          checkbox({ name: "featured" }),
          relationship({ name: "author", relationTo: "authors" }),
          fieldGroup({ name: "card", component: "card" }),
        ],
      }),
    ],
  });
  current = t;
  const author = await t.nextly.create({
    collection: "authors",
    data: { name: "Ada Writer", bio: "Writes." },
  });
  let articleId = "";
  for (let i = 0; i < 25; i++) {
    const created = await t.nextly.create({
      collection: "articles",
      data: {
        headline: `Article ${i}`,
        excerpt: `Excerpt ${i}.`,
        views: i * 7,
        publishedOn: new Date(
          Date.UTC(2025, 0, 1) + i * 3_600_000
        ).toISOString(),
        featured: i % 10 === 0,
        author: (author.item as { id: string }).id,
        card: { heading: `Card ${i}`, blurb: `Blurb ${i}.` },
      },
    });
    articleId = (created.item as { id: string }).id;
  }
  return { t, articleId };
}

/** The benchmark's two Direct API reads. */
function readsOf(t: TestNextly, articleId: string) {
  return {
    detail: () =>
      t.nextly.findByID({ collection: "articles", id: articleId, depth: 1 }),
    list: () =>
      t.nextly.find({
        collection: "articles",
        limit: 20,
        page: 1,
        sort: "publishedOn",
        depth: 1,
      }),
  };
}

function registryOf(t: TestNextly): DynamicCollectionRegistryService {
  return new DynamicCollectionRegistryService(t.adapter, consoleLogger);
}

/** The `articles` row's singular label, as the registry service answers it. */
async function singularOf(
  registry: DynamicCollectionRegistryService,
  executor?: unknown
): Promise<string | undefined> {
  const row = (await registry.getCollection("articles", executor)) as {
    labels?: { singular?: string } | string;
  };
  const labels =
    typeof row.labels === "string"
      ? (JSON.parse(row.labels) as { singular?: string })
      : row.labels;
  return labels?.singular;
}

/**
 * Writes the `articles` row's labels through the adapter alone, past the
 * registry services: what this process sees of another process's write.
 */
async function writeLabelsElsewhere(t: TestNextly, singular: string) {
  await t.adapter.update(
    "dynamic_collections",
    { labels: { singular, plural: `${singular}s` } },
    { and: [{ column: "slug", op: "=", value: "articles" }] }
  );
}

describe.each(getConfiguredTestDialects())(
  "the collection row cache (%s)",
  dialect => {
    it("answers reads the same warm as cold", async () => {
      const { t, articleId } = await bootSite(dialect);
      const reads = readsOf(t, articleId);
      for (const read of [reads.detail, reads.list]) {
        clearCollectionRowCache();
        const cold = await read();
        const warm = await read();
        expect(JSON.stringify(warm)).toBe(JSON.stringify(cold));
      }
    });

    it("sends a warm read 4 statements for an entry and 5 for a page, where without the cache it sends 11 and 13", async () => {
      const { t, articleId } = await bootSite(dialect);
      const reads = readsOf(t, articleId);
      const counted = async (read: () => Promise<unknown>) => {
        await read();
        return (await statementsOf(dialect, read)).length;
      };

      expect(await counted(reads.detail)).toBe(4);
      expect(await counted(reads.list)).toBe(5);
      bypass.on = true;
      expect(await counted(reads.detail)).toBe(11);
      expect(await counted(reads.list)).toBe(13);
    });

    it("sees every registry write a registry service makes at once", async () => {
      const { t } = await bootSite(dialect);
      const registry = registryOf(t);
      await singularOf(registry);

      // The Builder's path.
      await registry.updateCollectionMetadata("articles", {
        labels: { singular: "Story", plural: "Stories" },
      });
      expect(await singularOf(registry)).toBe("Story");

      // The code-first sync's path, through the other registry service.
      const collections = t.getService("collectionRegistryService") as {
        updateCollection(
          slug: string,
          data: object,
          options: { source: string }
        ): Promise<unknown>;
        updateMigrationStatus(slug: string, status: string): Promise<void>;
      };
      await collections.updateCollection(
        "articles",
        { labels: { singular: "Piece", plural: "Pieces" } },
        { source: "code" }
      );
      expect(await singularOf(registry)).toBe("Piece");

      await collections.updateMigrationStatus("articles", "pending");
      const row = (await registry.getCollection("articles")) as {
        migrationStatus: string;
      };
      expect(row.migrationStatus).toBe("pending");

      // Unregistered, then registered again under the same slug.
      const before = (await registry.getCollection("articles")) as Record<
        string,
        unknown
      >;
      await registry.unregisterCollection("articles");
      await expect(registry.getCollection("articles")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await registry.registerCollection({
        ...before,
        labels: { singular: "Entry", plural: "Entries" },
      } as unknown as CollectionMetadata);
      expect(await singularOf(registry)).toBe("Entry");
    });

    it("sees a change made elsewhere once the cached row's second is up, and not before", async () => {
      const { t } = await bootSite(dialect);
      const registry = registryOf(t);
      vi.useFakeTimers({ toFake: ["performance"] });
      // Rows cached while the site booted were timed on the real clock; the
      // read below is the first on the faked one.
      clearCollectionRowCache();
      const before = await singularOf(registry);

      await writeLabelsElsewhere(t, "Report");
      vi.advanceTimersByTime(COLLECTION_ROW_LIFETIME_MS - 1);
      expect(await singularOf(registry)).toBe(before);

      vi.advanceTimersByTime(1);
      expect(await singularOf(registry)).toBe("Report");
    });

    it("never answers a read inside a transaction, or on an executor, from the cache", async () => {
      const { t } = await bootSite(dialect);
      const registry = registryOf(t);
      const cached = await singularOf(registry);
      // Committed past the registry services: the cache still holds the
      // earlier row.
      await writeLabelsElsewhere(t, "Notice");
      expect(await singularOf(registry)).toBe(cached);

      // Inside a transaction, the row is read, and the write is seen.
      let inside: string | undefined;
      await t.adapter.transaction(async () => {
        inside = await singularOf(registry);
      });
      expect(inside).toBe("Notice");
      // On an executor the caller hands in, likewise.
      expect(await singularOf(registry, t.adapter.getDrizzle())).toBe("Notice");
    });
  }
);
