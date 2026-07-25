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
import { resolveBuilderRevalidate } from "../../../revalidation/builder-revalidate";
import { createAdapter } from "../../../database/factory";
import { container } from "../../../di/container";
// Used to model a committed-but-hook-failed write: a code afterCreate hook that
// throws (NextlyError + register/unregisterHook + HookHandler) so a batch item
// commits its row yet reports failure, pinning that its tags still get busted.
import { NextlyError } from "../../../errors/nextly-error";
import { registerHook, unregisterHook } from "../../../hooks";
import type { HookHandler } from "../../../hooks/types";
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
import type { CollectionService } from "../services/collection-service";
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

  it("busts the old and new slug tags on a batch update rename", async () => {
    const entries = await boot([openCollection("batchren")]);
    const created = await entries.createEntry(
      { collectionName: "batchren", overrideAccess: true },
      { title: "R", slug: "before" }
    );
    const id = (created.data as { id: string }).id;
    spy.flushed.length = 0;

    await entries.updateEntries(
      { collectionName: "batchren", overrideAccess: true },
      [{ id, data: { slug: "after" } }]
    );

    // The batch update worker carries the previous slug, so a batch rename busts
    // the stale slug tag too.
    expect(spy.tags).toContain("nextly:batchren:slug:after");
    expect(spy.tags).toContain("nextly:batchren:slug:before");
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

  it("carries per-item intents on a caller-owned createEntriesInTransaction result", async () => {
    const entries = await boot([openCollection("ownedtx")]);
    // The caller owns the transaction, so the method does not flush — it surfaces
    // the intents on the result for the caller to flush after IT commits.
    const result = await handle!.adapter.transaction(tx =>
      entries.createEntriesInTransaction(tx, { collectionName: "ownedtx" }, [
        { title: "A", slug: "a" },
        { title: "B", slug: "b" },
      ])
    );
    const flushedTags = (result.revalidationIntents ?? []).flatMap(i => i.tags);
    expect(flushedTags).toContain("nextly:ownedtx:slug:a");
    expect(flushedTags).toContain("nextly:ownedtx:slug:b");
    // The caller owns the commit, so nothing may be flushed to the revalidator
    // before it: a premature pre-commit flush would revalidate uncommitted data.
    expect(spy.flushed).toHaveLength(0);
  });

  it("busts the slug tag even when field-level read access hides slug", async () => {
    // A batch create for a non-override user where slug's read access is denied:
    // redactResponseFields strips slug from the returned row, so the intent must
    // be computed from the pre-redaction row.
    const entries = await boot([
      defineCollection({
        slug: "redact",
        status: true,
        access: { create: () => true },
        fields: [
          text({ name: "title" }),
          text({ name: "slug", access: { read: () => false } }),
        ],
      }),
    ]);
    await entries.createEntries(
      { collectionName: "redact", user: { id: "u" } },
      [{ title: "T", slug: "hidden-slug" }]
    );
    expect(spy.tags).toContain("nextly:redact:slug:hidden-slug");
  });

  it("busts tags for a committed batch item whose afterCreate hook throws", async () => {
    const entries = await boot([openCollection("hookfail")]);
    // A code afterCreate hook that always throws. In a batch (stopOnError:false)
    // the row still commits, so the item's tags must be busted even though it is
    // reported as a failure — the intent is computed before the hooks run.
    const throwingHook: HookHandler = async () => {
      throw NextlyError.internal({ logContext: { reason: "test-hook-throw" } });
    };
    registerHook("afterCreate", "hookfail", throwingHook);
    try {
      const result = await entries.createEntries(
        { collectionName: "hookfail", overrideAccess: true },
        [{ title: "T", slug: "committed" }],
        { stopOnError: false }
      );
      expect(result.failed).toBe(1); // the hook threw, so the item is a failure
      // …but the row committed, so its tags were still busted.
      expect(spy.tags).toContain("nextly:hookfail:slug:committed");
    } finally {
      unregisterHook("afterCreate", "hookfail", throwingHook);
    }
  });

  it("carries the intent on a single createEntryInTransaction result", async () => {
    const entries = await boot([openCollection("singletx")]);
    // A caller-owned single transactional write (via withTransaction). It does
    // not flush; the intent is on the result for the caller to flush post-commit.
    const result = await handle!.adapter.transaction(tx =>
      entries.createEntryInTransaction(
        tx,
        { collectionName: "singletx", overrideAccess: true },
        { title: "T", slug: "single-s" }
      )
    );
    expect(result.revalidationIntent?.tags).toContain(
      "nextly:singletx:slug:single-s"
    );
    // Caller-owned: the intent rides the result, but nothing is flushed before
    // the caller's own commit.
    expect(spy.flushed).toHaveLength(0);
  });

  it("flushes a CollectionService.withTransaction's wrapper intents after commit", async () => {
    // The public CollectionService transaction wrappers return only the entry,
    // so the intent has nowhere to ride on the result. withTransaction is the
    // seam that collects each wrapper's intent and flushes it once the
    // transaction commits — verify a committed write through it busts its tag.
    await boot([openCollection("wtx")]);
    const service = handle!.getService<CollectionService>("collectionService");
    await service.withTransaction(async tx => {
      await service.createEntryInTransaction(
        tx,
        "wtx",
        { title: "T", slug: "wtx-slug" },
        { user: undefined }
      );
    });
    expect(spy.tags).toContain("nextly:wtx:slug:wtx-slug");
  });

  it("flushes nothing when a CollectionService.withTransaction rolls back", async () => {
    // Tags may only bust after the transaction commits: if work throws, the
    // transaction rolls back, so the collected intent must never reach the
    // revalidator.
    await boot([openCollection("wtxroll")]);
    const service = handle!.getService<CollectionService>("collectionService");
    await expect(
      service.withTransaction(async tx => {
        await service.createEntryInTransaction(
          tx,
          "wtxroll",
          { title: "T", slug: "rolled" },
          { user: undefined }
        );
        throw NextlyError.internal({ logContext: { reason: "test-rollback" } });
      })
    ).rejects.toThrow();
    expect(spy.flushed).toHaveLength(0);
  });

  it("busts tags when a wrapper's hook fails but the owned transaction commits", async () => {
    // The row is written before the afterCreate hook runs, so a throwing hook
    // leaves it committed if the caller swallows the wrapper error. The wrapper
    // must have collected the intent before throwing, so the committed row's
    // tags still bust.
    await boot([openCollection("hookcommit")]);
    const service = handle!.getService<CollectionService>("collectionService");
    const throwingHook: HookHandler = async () => {
      throw NextlyError.internal({ logContext: { reason: "test-hook-throw" } });
    };
    registerHook("afterCreate", "hookcommit", throwingHook);
    try {
      await service.withTransaction(async tx => {
        try {
          await service.createEntryInTransaction(
            tx,
            "hookcommit",
            { title: "T", slug: "committed-hook" },
            { user: undefined }
          );
        } catch {
          // Commit despite the hook failure — the row already wrote.
        }
      });
      expect(spy.tags).toContain("nextly:hookcommit:slug:committed-hook");
    } finally {
      unregisterHook("afterCreate", "hookcommit", throwingHook);
    }
  });

  it("flushes nothing when the collection's revalidate config is disabled", async () => {
    // The `revalidate: { disable: true }` config must round-trip through the
    // registry and reach the write site, so a disabled collection busts nothing.
    const entries = await boot([
      defineCollection({
        slug: "noreval",
        status: true,
        access: { create: () => true },
        revalidate: { disable: true },
        fields: [text({ name: "title" }), text({ name: "slug" })],
      }),
    ]);
    await entries.createEntry(
      { collectionName: "noreval", overrideAccess: true },
      { title: "T", slug: "hidden" }
    );
    expect(spy.flushed).toHaveLength(0);
  });

  it("includes the collection's configured extra revalidate tags", async () => {
    // The `revalidate: { tags: [...] }` config must round-trip and be merged into
    // every write's intent.
    const entries = await boot([
      defineCollection({
        slug: "tagged",
        status: true,
        access: { create: () => true },
        revalidate: { tags: ["navigation"] },
        fields: [text({ name: "title" }), text({ name: "slug" })],
      }),
    ]);
    await entries.createEntry(
      { collectionName: "tagged", overrideAccess: true },
      { title: "T", slug: "y" }
    );
    expect(spy.tags).toContain("navigation");
    expect(spy.tags).toContain("nextly:tagged:slug:y");
  });

  it("busts nothing for a Builder collection with revalidation turned off", async () => {
    // Parity: the Schema Builder switch OFF resolves to the disable config, and
    // once persisted the write path must honor it exactly like a code-first
    // opt-out. Binding the resolver output here catches a drift in either.
    const entries = await boot([
      defineCollection({
        slug: "builderoff",
        status: true,
        access: { create: () => true },
        revalidate: resolveBuilderRevalidate(false) ?? undefined,
        fields: [text({ name: "title" }), text({ name: "slug" })],
      }),
    ]);
    await entries.createEntry(
      { collectionName: "builderoff", overrideAccess: true },
      { title: "T", slug: "off" }
    );
    expect(spy.flushed).toHaveLength(0);
  });

  it("busts the standard tags for a Builder collection with revalidation on", async () => {
    // The Builder switch ON resolves to null (no override), so a Builder-created
    // collection busts the same derived tags a code-first one does.
    const entries = await boot([
      defineCollection({
        slug: "builderon",
        status: true,
        access: { create: () => true },
        revalidate: resolveBuilderRevalidate(true) ?? undefined,
        fields: [text({ name: "title" }), text({ name: "slug" })],
      }),
    ]);
    await entries.createEntry(
      { collectionName: "builderon", overrideAccess: true },
      { title: "T", slug: "on" }
    );
    expect(spy.tags).toContain("nextly:builderon");
    expect(spy.tags).toContain("nextly:builderon:slug:on");
  });

  it("resolves a cache adapter registered AFTER construction (lazy, codex-194)", async () => {
    // The Next cache adapter registers at request time, well after boot. A write
    // must resolve the revalidator at flush time, not capture the boot-time
    // default at construction — otherwise a boot path that touches the entry
    // service memoizes the no-op and ignores the adapter that registers later.
    const entries = await boot([openCollection("late")]);
    // Register a second revalidator AFTER the service was constructed; it must
    // win. With an eager capture, `spy` (registered pre-boot) would receive the
    // flush and `lateSpy` would get nothing — this fails there and passes here.
    const lateSpy = new RecordingRevalidator();
    container.registerSingleton<CacheRevalidator>(
      "cacheRevalidator",
      () => lateSpy
    );
    await entries.createEntry(
      { collectionName: "late", overrideAccess: true },
      { title: "T", slug: "z" }
    );
    expect(lateSpy.tags).toContain("nextly:late:slug:z");
    expect(spy.flushed).toHaveLength(0);
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

  it("flushes nothing when the single's revalidate config is disabled", async () => {
    // Singles persist + read `revalidate` through their own registry
    // deserialize path, so verify a disabled single busts nothing.
    const adapter = await memoryAdapter();
    handle = await createTestNextly({
      adapter,
      singles: [
        defineSingle({
          slug: "footer",
          access: { read: () => true, update: () => true },
          revalidate: { disable: true },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const singleEntry =
      handle.getService<SingleEntryService>("singleEntryService");
    await singleEntry.update(
      "footer",
      { title: "Site" },
      { overrideAccess: true }
    );
    expect(spy.flushed).toHaveLength(0);
  });
});
