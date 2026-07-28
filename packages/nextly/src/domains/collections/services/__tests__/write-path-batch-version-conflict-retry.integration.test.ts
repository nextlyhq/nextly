/**
 * Proof that a batch write retries the whole transaction on a version-allocation
 * race, exactly as the interactive path does.
 *
 * `createEntries`/`updateEntries` own their transaction, so when concurrent
 * writes to the same versioned entry collide on `max(version_no) + 1`, capture
 * raises `VersionConflictError` and the batch must re-run — not roll back and
 * report the routine race as a failed batch. The re-run also has to reset the
 * result accumulators so a retried attempt does not double-count the rolled-back
 * one.
 *
 * The race is injected deterministically by spying on
 * `VersionCaptureService.prototype.capture` to raise `VersionConflictError` on
 * its first call and delegate to the real implementation afterwards, so no real
 * concurrency is needed.
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

describe("batch write version-conflict retry (integration)", () => {
  it("retries the whole batch and does not double-count on a version conflict", async () => {
    const entries = await boot();

    // Fail the FIRST capture with a version conflict, then run for real. The
    // batch's first attempt rolls back; the retry re-runs every item and lands.
    const realCapture = VersionCaptureService.prototype.capture;
    let calls = 0;
    vi.spyOn(VersionCaptureService.prototype, "capture").mockImplementation(
      function (this: VersionCaptureService, ...args) {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new VersionConflictError());
        }
        return realCapture.apply(this, args);
      }
    );

    const result = await entries.createEntries(
      { collectionName: COLLECTION, overrideAccess: true },
      [{ title: "a" }, { title: "b" }]
    );

    // The first capture threw, forcing a retry; the retry captured both.
    expect(calls).toBeGreaterThanOrEqual(3);
    // Retried cleanly: both items count once, none doubled, none failed.
    expect(result.successful).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.ids).toHaveLength(2);

    // Both rows persist, and each carries exactly one version from the winning
    // attempt (the rolled-back attempt left nothing behind).
    const rows = await handle!.adapter.executeQuery<{ id: string }>(
      `SELECT id FROM dc_posts`
    );
    expect(rows).toHaveLength(2);
    const versions = await handle!.adapter.select<{ scopeSlug: string }>(
      "nextly_versions"
    );
    expect(versions.filter(v => v.scopeSlug === COLLECTION)).toHaveLength(2);
  });
});
