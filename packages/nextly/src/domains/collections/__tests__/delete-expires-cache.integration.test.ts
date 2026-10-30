/**
 * Deleting a collection or a Single expires the cached reads of it.
 *
 * Every cached read of a deleted collection or Single describes content that is gone, but
 * the delete went around the entry services that flush on a write, so those
 * reads were served until something else expired them. One that opts
 * out of revalidation owns its own freshness, and its delete flushes nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { container } from "../../../di/container";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type {
  CacheRevalidator,
  RevalidationIntent,
} from "../../../revalidation/types";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleMetadataService } from "../../singles/services/single-metadata-service";

/** Records every intent flushed to it. */
class RecordingRevalidator implements CacheRevalidator {
  readonly flushed: RevalidationIntent[] = [];
  flush(intents: RevalidationIntent[]): void {
    this.flushed.push(...intents);
  }
  get tags(): string[] {
    return this.flushed.flatMap(intent => intent.tags);
  }
}

describe("deleting a collection (sqlite)", () => {
  let handle: TestNextly | undefined;
  let spy: RecordingRevalidator;

  beforeEach(() => {
    spy = new RecordingRevalidator();
    // Registered before boot, so registerServices keeps it rather than the no-op.
    container.registerSingleton<CacheRevalidator>(
      "cacheRevalidator",
      () => spy
    );
  });

  afterEach(async () => {
    await handle?.destroy();
    handle = undefined;
  });

  async function handler(): Promise<CollectionsHandler> {
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    handle = await createTestNextly({ adapter, collections: [] });
    return handle.getService("collectionsHandler");
  }

  it("expires every cached read of it", async () => {
    const h = await handler();
    const created = await h.createCollection({
      name: "notes",
      label: "Note",
      fields: [{ name: "title", type: "text" }],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    spy.flushed.length = 0;

    const deleted = await h.deleteCollection({ collectionName: "notes" });
    expect(deleted.success, JSON.stringify(deleted)).toBe(true);
    expect(spy.tags).toContain("nextly:notes");
  });

  it("flushes nothing for a collection that opts out of revalidation", async () => {
    const h = await handler();
    const created = await h.createCollection({
      name: "drafts",
      label: "Draft",
      fields: [{ name: "title", type: "text" }],
      revalidate: false,
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    spy.flushed.length = 0;

    const deleted = await h.deleteCollection({ collectionName: "drafts" });
    expect(deleted.success, JSON.stringify(deleted)).toBe(true);
    expect(spy.tags).toEqual([]);
  });

  async function singles(): Promise<SingleMetadataService> {
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    handle = await createTestNextly({ adapter, collections: [] });
    return handle.getService(
      "singleMetadataService" as never
    ) as unknown as SingleMetadataService;
  }

  /** A Single made in the admin, which can be deleted (one defined in code cannot). */
  async function adminSingle(
    metadata: SingleMetadataService,
    slug: string,
    revalidate?: { disable: true }
  ) {
    await metadata.createSingle({
      slug,
      label: slug,
      tableName: `single_${slug}`,
      fields: [{ name: "headline", type: "text" }],
      source: "ui",
      locked: false,
      schemaHash: `delete-expires-${slug}`,
      schemaVersion: 1,
      ...(revalidate ? { revalidate } : {}),
    } as never);
  }

  it("expires every cached read of a deleted Single", async () => {
    const metadata = await singles();
    await adminSingle(metadata, "banner");
    spy.flushed.length = 0;

    await metadata.deleteSingle("banner", "single_banner");
    expect(spy.tags).toContain("nextly:single:banner");
  });

  it("flushes nothing for a Single that opts out of revalidation", async () => {
    const metadata = await singles();
    await adminSingle(metadata, "notice", { disable: true });
    spy.flushed.length = 0;

    await metadata.deleteSingle("notice", "single_notice");
    expect(spy.tags).toEqual([]);
  });
});
