/**
 * Proof that a version-allocation conflict aborts a batch write cleanly — no
 * orphaned content row, no partially-applied batch.
 *
 * A batch runs every item on ONE transaction with no per-item savepoint, and a
 * unique-index collision poisons that transaction, so the whole batch must roll
 * back. The batch deliberately does NOT retry the transaction: re-running would
 * replay every preceding item's (non-transactional) hooks — duplicate emails,
 * discarded ids. So a conflict surfaces as a clean failure the caller can retry
 * at the application level, and nothing is left half-written.
 *
 * The conflict is injected deterministically by making the first capture raise
 * VersionConflictError; no real concurrency is needed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";
import { VersionCaptureService } from "../../../versions/version-capture-service";
import { VersionConflictError } from "../../../versions/version-conflict";

let handle: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await handle?.destroy();
  handle = undefined;
});

const COLLECTION = "posts";

async function boot(): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    collections: [
      defineCollection({
        slug: COLLECTION,
        versions: true,
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return handle
    .getService<CollectionsHandler>("collectionsHandler")
    .getEntryService() as CollectionEntryService;
}

describe("batch write version-conflict handling (integration)", () => {
  it("aborts the whole batch on a version conflict, leaving nothing behind", async () => {
    const entries = await boot();

    // The first capture loses the allocation race. With no retry, this aborts
    // the transaction rather than re-running the batch's hooks.
    vi.spyOn(VersionCaptureService.prototype, "capture").mockImplementationOnce(
      () => Promise.reject(new VersionConflictError())
    );

    const result = await entries.createEntries(
      { collectionName: COLLECTION, overrideAccess: true },
      [{ title: "a" }, { title: "b" }]
    );

    // The batch failed as a whole; nothing counts as successful, and the counts
    // account for every requested item.
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.ids).toHaveLength(0);

    // No orphaned content row and no orphaned version were committed.
    const rows = await handle!.adapter.executeQuery<{ id: string }>(
      `SELECT id FROM dc_posts`
    );
    expect(rows).toHaveLength(0);
    const versions = await handle!.adapter.select<{ scopeSlug: string }>(
      "nextly_versions"
    );
    expect(versions.filter(v => v.scopeSlug === COLLECTION)).toHaveLength(0);
  });
});
