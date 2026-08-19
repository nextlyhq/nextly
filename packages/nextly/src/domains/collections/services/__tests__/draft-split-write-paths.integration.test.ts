/**
 * The draft/published split holds on EVERY collection write path.
 *
 * A status-less update to a published, drafts-enabled document must store the
 * pending edit and leave the live row alone. That was true only of the pooled
 * `updateEntry` path: the eligibility predicate had one call site, so the
 * transaction-owning surface the Direct API and plugins use, and the batch
 * surface underneath bulk updates, wrote straight to the live row.
 *
 * Each case asserts BOTH halves, in the same test. "The live row is unchanged"
 * is satisfied just as well by a write that stored nothing at all, so the
 * pending change has to be shown to exist beside it — otherwise a system that
 * silently dropped the edit would pass.
 *
 * `updateEntry` is included as the control. It passes before the fix and after
 * it, which is what separates "the test works" from "the surface works".
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../../services/collections-handler";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const COLLECTION = "wpposts";
const TABLE = "dc_wpposts";

async function boot(): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    collections: [
      defineCollection({
        slug: COLLECTION,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" }), text({ name: "body" })],
      }),
    ],
  });
  return (
    handle.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

/** A published document to edit. */
async function publish(entries: CollectionEntryService): Promise<string> {
  const created = await entries.createEntry(
    { collectionName: COLLECTION, overrideAccess: true },
    { title: "live title", body: "live body", status: "published" }
  );
  return (created.data as { id: string }).id;
}

async function liveRow(id: string): Promise<{ title: string; body: string }> {
  const rows = await handle!.adapter.select<{ title: string; body: string }>(
    TABLE,
    { where: { and: [{ column: "id", op: "=", value: id }] }, limit: 1 }
  );
  return rows[0];
}

/** The pending change for a document, if the split stored one. */
async function workingDrafts(id: string): Promise<{ snapshot: unknown }[]> {
  return handle!.adapter.select<{ snapshot: unknown }>("nextly_versions", {
    where: {
      and: [
        { column: "entryId", op: "=", value: id },
        { column: "isAutosave", op: "=", value: false },
        { column: "versionNo", op: "IS NULL" },
        { column: "status", op: "=", value: "draft" },
      ],
    },
  });
}

describe("draft/published split on every write path (integration)", () => {
  it("holds the edit on updateEntry (the control)", async () => {
    const entries = await boot();
    const id = await publish(entries);

    await entries.updateEntry(
      { collectionName: COLLECTION, entryId: id, overrideAccess: true },
      { body: "edited body" }
    );

    expect(await workingDrafts(id)).toHaveLength(1);
    expect((await liveRow(id)).body).toBe("live body");
  });

  it("holds the edit on updateEntryInTransaction", async () => {
    const entries = await boot();
    const id = await publish(entries);

    await handle!.adapter.transaction(tx =>
      entries.updateEntryInTransaction(
        tx as never,
        { collectionName: COLLECTION, entryId: id, overrideAccess: true },
        { body: "edited body" }
      )
    );

    expect(await workingDrafts(id)).toHaveLength(1);
    expect((await liveRow(id)).body).toBe("live body");
  });

  it("holds the edit on a bulk update", async () => {
    const entries = await boot();
    const first = await publish(entries);
    const second = await publish(entries);

    // More than one entry, so the batch shape is real rather than a batch of one.
    await entries.updateEntries({ collectionName: COLLECTION }, [
      { id: first, data: { body: "edited body" } },
      { id: second, data: { body: "edited body" } },
    ]);

    for (const id of [first, second]) {
      expect(await workingDrafts(id)).toHaveLength(1);
      expect((await liveRow(id)).body).toBe("live body");
    }
  });
});
