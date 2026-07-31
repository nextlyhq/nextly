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
        fields: [text({ name: "title" }), text({ name: "body" })],
      }),
    ],
  });
  return handle
    .getService<CollectionsHandler>("collectionsHandler")
    .getEntryService() as CollectionEntryService;
}

type LiveRow = { id: string; title: string; body: string; status: string };
type VersionRow = {
  snapshot: { title?: string; body?: string };
  status: string;
  versionNo: number | null;
};

async function workingDraftCount(id: string): Promise<number> {
  return (
    await handle!.adapter.select<VersionRow>("nextly_versions", {
      where: {
        and: [
          { column: "entryId", op: "=", value: id },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NULL" },
          { column: "status", op: "=", value: "draft" },
        ],
      },
    })
  ).length;
}

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

  it("surfaces the working draft on a trusted draft-view read, but the live row on a published-view read", async () => {
    const entries = await boot();
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [row] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "edited-in-draft" }
    );

    // Draft view: no explicit status on a trusted read resolves the status
    // filter to null, so the overlay returns the pending edit.
    const draftRead = await entries.getEntry({ ...ctx, entryId: id });
    expect((draftRead.data as { title?: string }).title).toBe(
      "edited-in-draft"
    );

    // Published view: an explicit status filter suppresses the overlay, so the
    // live (unchanged) row is returned.
    const publishedRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      status: "published",
    });
    expect((publishedRead.data as { title?: string }).title).toBe("live");
  });
});

// Publishing a document that has a pending working draft must apply the draft's
// whole content to the live row, not just the fields the publish call carried —
// the admin Publish button sends only the fields dirtied this session, so a
// status-only publish still has to bring the accumulated edits live. Unpublish
// is the same fold with a draft target status.
describe("draft/published split — promote on publish (integration)", () => {
  it("promotes the whole working draft to the live row when the publish omits its fields", async () => {
    const entries = await boot();
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live-t",
      body: "live-b",
      status: "published",
    });
    const [before] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = before.id;

    // A status-less edit stores the pending title AND body as one working draft.
    await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "draft-t", body: "draft-b" }
    );
    expect(await workingDraftCount(id)).toBe(1);
    const [mid] = await handle!.adapter.select<LiveRow>(TABLE);
    expect(mid.title).toBe("live-t");
    expect(mid.body).toBe("live-b");

    // Publish carrying ONLY the status (the admin Publish button on an unedited
    // pending draft) must promote the draft's title and body to the live row.
    const res = await entries.updateEntry(
      { ...ctx, entryId: id },
      { status: "published" }
    );
    expect(res.success).toBe(true);

    const [after] = await handle!.adapter.select<LiveRow>(TABLE);
    expect(after.title).toBe("draft-t");
    expect(after.body).toBe("draft-b");
    expect(after.status).toBe("published");
    // The sidecar draft is consumed in the same transaction.
    expect(await workingDraftCount(id)).toBe(0);
  });

  it("overlays the publish payload on the draft, with the caller winning per field", async () => {
    const entries = await boot();
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live-t",
      body: "live-b",
      status: "published",
    });
    const [before] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = before.id;

    await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "draft-t", body: "draft-b" }
    );

    // Publish re-titles in the same call: the payload's title wins, the draft
    // supplies the body the payload did not carry.
    await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "final-t", status: "published" }
    );

    const [after] = await handle!.adapter.select<LiveRow>(TABLE);
    expect(after.title).toBe("final-t");
    expect(after.body).toBe("draft-b");
    expect(after.status).toBe("published");
    expect(await workingDraftCount(id)).toBe(0);
  });

  it("folds the draft into the live row as a draft on unpublish, clearing the sidecar", async () => {
    const entries = await boot();
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live-t",
      body: "live-b",
      status: "published",
    });
    const [before] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = before.id;

    await entries.updateEntry({ ...ctx, entryId: id }, { title: "draft-t" });

    // Unpublish names status:draft, so the accumulated draft content lands on
    // the live row and the row itself is retracted to draft.
    await entries.updateEntry({ ...ctx, entryId: id }, { status: "draft" });

    const [after] = await handle!.adapter.select<LiveRow>(TABLE);
    expect(after.title).toBe("draft-t");
    expect(after.body).toBe("live-b");
    expect(after.status).toBe("draft");
    expect(await workingDraftCount(id)).toBe(0);
  });

  it("publishes normally when no working draft exists", async () => {
    const entries = await boot();
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live-t",
      body: "live-b",
      status: "draft",
    });
    const [before] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = before.id;

    // First publish of a never-drafted document: no sidecar to fold, the
    // payload is written as-is.
    const res = await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "pub-t", status: "published" }
    );
    expect(res.success).toBe(true);

    const [after] = await handle!.adapter.select<LiveRow>(TABLE);
    expect(after.title).toBe("pub-t");
    expect(after.body).toBe("live-b");
    expect(after.status).toBe("published");
    expect(await workingDraftCount(id)).toBe(0);
  });
});
