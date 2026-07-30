import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";

// Stage B walking skeleton: on a split-enabled collection (a draft/publish
// lifecycle + drafts-enabled versioning), an update to a PUBLISHED document that
// names no status is non-destructive — the live row is left untouched and the
// pending edit is stored as the working draft.
let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const COLLECTION = "posts";
const TABLE = "dc_posts";

async function boot(): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    collections: [
      defineCollection({
        slug: COLLECTION,
        status: true,
        versions: { drafts: true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return handle
    .getService<CollectionsHandler>("collectionsHandler")
    .getEntryService() as CollectionEntryService;
}

type LiveRow = { id: string; title: string; status: string };
type VersionRow = {
  snapshot: { title?: string };
  status: string;
  versionNo: number | null;
};

describe("draft/published split — updateEntry (integration)", () => {
  it("stores a status-less edit of a published doc as a working draft, leaving the live row untouched", async () => {
    const entries = await boot();
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [liveBefore] = await handle!.adapter.select<LiveRow>(TABLE);
    expect(liveBefore.status).toBe("published");
    const id = liveBefore.id;

    const durableCount = async (): Promise<number> =>
      (
        await handle!.adapter.select<VersionRow>("nextly_versions", {
          where: {
            and: [
              { column: "entryId", op: "=", value: id },
              { column: "versionNo", op: "IS NOT NULL" },
            ],
          },
        })
      ).length;
    const durableBefore = await durableCount();

    // Edit with NO status -> non-destructive draft edit.
    const res = await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "edited-in-draft" }
    );
    expect(res.success).toBe(true);

    // The live row is unchanged: title AND status.
    const [liveAfter] = await handle!.adapter.select<LiveRow>(TABLE);
    expect(liveAfter.title).toBe("live");
    expect(liveAfter.status).toBe("published");

    // The edit lives in exactly one working draft (status='draft', no version
    // number, not autosave) carrying the new title.
    const drafts = await handle!.adapter.select<VersionRow>("nextly_versions", {
      where: {
        and: [
          { column: "entryId", op: "=", value: id },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NULL" },
          { column: "status", op: "=", value: "draft" },
        ],
      },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].snapshot.title).toBe("edited-in-draft");

    // No durable (numbered) version was stamped for the draft edit.
    expect(await durableCount()).toBe(durableBefore);
  });
});
