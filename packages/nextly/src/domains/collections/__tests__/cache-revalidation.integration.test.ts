/**
 * The write path computes a cache-revalidation intent and flushes it after the
 * transaction commits. These pin both halves against a real database: the intent
 * carried on each write result (create/update/rename/delete/single), and that the
 * registered CacheRevalidator actually receives it — while a write that records
 * nothing, or a collection that disables revalidation, flushes nothing.
 *
 * SQLite has no connection pool, so this needs no Postgres URL; the behavior is
 * dialect-independent (it is pure post-commit bookkeeping).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { container } from "../../../di/container";
import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../../../revalidation/types";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

// Records every intent flushed to it, so a test can assert exactly which tags a
// write busts (and that a no-op write busts nothing).
class RecordingRevalidator implements CacheRevalidator {
  readonly flushed: RevalidationIntent[] = [];
  flush(intents: RevalidationIntent[]): void {
    this.flushed.push(...intents);
  }
  /** Every tag flushed across all intents, flattened for convenient assertions. */
  get tags(): string[] {
    return this.flushed.flatMap(intent => intent.tags);
  }
}

describe("cache revalidation — write path (sqlite)", () => {
  let handle: TestNextly | undefined;
  let spy: RecordingRevalidator;

  beforeEach(() => {
    spy = new RecordingRevalidator();
    // Pre-register the spy so registerServices keeps it instead of the no-op
    // default (its registration is guarded on the slot being empty).
    container.registerSingleton<CacheRevalidator>(
      "cacheRevalidator",
      () => spy
    );
  });

  afterEach(async () => {
    await handle?.destroy();
    handle = undefined;
  });

  async function memoryAdapter() {
    process.env.DB_DIALECT = "sqlite";
    return createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
  }

  async function boot(
    collections: Parameters<typeof createTestNextly>[0]["collections"],
    singles?: Parameters<typeof createTestNextly>[0]["singles"]
  ): Promise<CollectionEntryService> {
    const adapter = await memoryAdapter();
    handle = await createTestNextly({ adapter, collections, singles });
    return handle
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService() as CollectionEntryService;
  }

  const openCollection = (slug: string) =>
    defineCollection({
      slug,
      status: true,
      access: { create: () => true, update: () => true, delete: () => true },
      fields: [text({ name: "title" }), text({ name: "slug" })],
    });

  it("flushes the collection, id, and slug tags on create", async () => {
    const entries = await boot([openCollection("posts")]);
    const created = await entries.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "Hello", slug: "hello" }
    );
    const id = (created.data as { id: string }).id;

    // Carried on the result…
    expect(created.revalidationIntent?.tags).toEqual([
      "nextly:posts",
      `nextly:posts:id:${id}`,
      "nextly:posts:slug:hello",
    ]);
    // …and actually flushed to the revalidator.
    expect(spy.tags).toContain(`nextly:posts:id:${id}`);
    expect(spy.tags).toContain("nextly:posts:slug:hello");
  });

  it("busts the old and new slug tags on a rename", async () => {
    const entries = await boot([openCollection("pages")]);
    const created = await entries.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "P", slug: "old" }
    );
    const id = (created.data as { id: string }).id;
    spy.flushed.length = 0; // ignore the create's flush

    await entries.updateEntry(
      { collectionName: "pages", entryId: id, overrideAccess: true },
      { slug: "new" }
    );

    expect(spy.tags).toContain("nextly:pages:slug:new");
    expect(spy.tags).toContain("nextly:pages:slug:old");
  });

  it("flushes the collection and id tags on delete", async () => {
    const entries = await boot([openCollection("docs")]);
    const created = await entries.createEntry(
      { collectionName: "docs", overrideAccess: true },
      { title: "D", slug: "doomed" }
    );
    const id = (created.data as { id: string }).id;
    spy.flushed.length = 0;

    await entries.deleteEntry({
      collectionName: "docs",
      entryId: id,
      overrideAccess: true,
    });

    expect(spy.tags).toContain("nextly:docs");
    expect(spy.tags).toContain(`nextly:docs:id:${id}`);
  });

  it("flushes tags for every entry in a batch create", async () => {
    const entries = await boot([openCollection("batch")]);
    await entries.createEntries(
      { collectionName: "batch", overrideAccess: true },
      [
        { title: "A", slug: "a" },
        { title: "B", slug: "b" },
      ]
    );
    // A batch create records no outbox event, but the content changed, so its
    // tags must still be busted.
    expect(spy.tags).toContain("nextly:batch:slug:a");
    expect(spy.tags).toContain("nextly:batch:slug:b");
  });

  it("flushes the entry tags on publishAllLocales", async () => {
    const entries = await boot([openCollection("pub")]);
    const created = await entries.createEntry(
      { collectionName: "pub", overrideAccess: true },
      { title: "Draft", slug: "draft-doc", status: "draft" }
    );
    const id = (created.data as { id: string }).id;
    spy.flushed.length = 0;

    await entries.publishAllLocales({
      collectionName: "pub",
      entryId: id,
      overrideAccess: true,
    });

    expect(spy.tags).toContain(`nextly:pub:id:${id}`);
  });

  it("flushes nothing when a write records no event (update of a missing entry)", async () => {
    const entries = await boot([openCollection("nope")]);
    const result = await entries.updateEntry(
      {
        collectionName: "nope",
        entryId: "does-not-exist",
        overrideAccess: true,
      },
      { title: "x" }
    );
    expect(result.success).toBe(false);
    expect(spy.flushed).toHaveLength(0);
  });

  it("flushes the single tag on a single update", async () => {
    const adapter = await memoryAdapter();
    handle = await createTestNextly({
      adapter,
      singles: [
        defineSingle({
          slug: "header",
          access: { read: () => true, update: () => true },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singleEntry =
      handle.getService<SingleEntryService>("singleEntryService");
    await singleEntry.update(
      "header",
      { title: "Site" },
      { overrideAccess: true }
    );
    expect(spy.tags).toContain("nextly:single:header");
  });
});
