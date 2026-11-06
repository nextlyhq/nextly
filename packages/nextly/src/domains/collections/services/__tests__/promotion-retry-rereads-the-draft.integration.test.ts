// A publish that loses the version-number race retries from what it finds on
// the retry, never from what the lost attempt read.
//
// The plausible broken implementation resets the write's own values for each
// attempt but not the translated values a promotion folded in: a retry that
// no longer finds the language's pending change then still writes the
// translation the lost attempt promoted, putting live content that is no
// longer anyone's pending change.

import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import { VersionCaptureService } from "../../../versions/version-capture-service";
import { VersionConflictError } from "../../../versions/version-conflict";
import { VersionsRepository } from "../../../versions/versions-repository";

let handle: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await handle?.destroy();
  handle = undefined;
});

const COLLECTION = "retryposts";

async function boot(): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    collections: [
      defineCollection({
        slug: COLLECTION,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return (
    handle.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

async function titleOf(
  entries: CollectionEntryService,
  id: string
): Promise<unknown> {
  const read = await entries.getEntry({
    collectionName: COLLECTION,
    entryId: id,
    overrideAccess: true,
    locale: "en",
  });
  return (read.data as { title?: unknown } | null)?.title;
}

describe("a publish that retries after a lost race", () => {
  it("writes no translation from a pending change the retry no longer finds", async () => {
    const entries = await boot();
    const created = await entries.createEntry(
      { collectionName: COLLECTION, overrideAccess: true, locale: "en" },
      { title: "Hello", status: "published" }
    );
    const id = (created.data as { id: string }).id;
    const scope = {
      collectionName: COLLECTION,
      entryId: id,
      overrideAccess: true,
      locale: "en",
    };
    // English's pending change: held, not yet live.
    await entries.updateEntry(scope, {
      title: "Hello again",
      _overwrite: true,
    });
    expect(await titleOf(entries, id)).toBe("Hello");

    const adapter = handle!.adapter;
    const repo = new VersionsRepository(
      adapter as unknown as ConstructorParameters<typeof VersionsRepository>[0]
    );
    const ref = {
      scopeKind: "collection" as const,
      scopeSlug: COLLECTION,
      entryId: id,
    };
    // The first attempt loses the race and rolls back; before the retry, the
    // pending change is discarded, so the retry publishes the status alone.
    vi.spyOn(VersionCaptureService.prototype, "capture").mockImplementationOnce(
      () => {
        throw new VersionConflictError();
      }
    );
    const transaction = adapter.transaction.bind(adapter);
    let attempts = 0;
    vi.spyOn(adapter, "transaction").mockImplementation((async (
      ...args: Parameters<typeof transaction>
    ) => {
      attempts += 1;
      if (attempts === 2) await repo.deleteWorkingDraft(ref, "en");
      return transaction(...args);
    }) as typeof adapter.transaction);

    const published = await entries.updateEntry(scope, {
      status: "published",
      _overwrite: true,
    });
    expect(published.success, JSON.stringify(published)).toBe(true);
    expect(attempts).toBeGreaterThanOrEqual(2);
    vi.restoreAllMocks();

    expect(await titleOf(entries, id)).toBe("Hello");
  });
});
