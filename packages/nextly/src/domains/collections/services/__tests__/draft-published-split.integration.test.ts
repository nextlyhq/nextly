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
    // The response reflects the pending draft the caller just saved, not the
    // unchanged live row the transaction re-fetches.
    expect((res.data as { title?: string }).title).toBe("edited-in-draft");

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

  it("accumulates disjoint status-less edits onto the working draft instead of overwriting them", async () => {
    const entries = await boot();
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live-t",
      body: "live-b",
      status: "published",
    });
    const [row] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // Two SEPARATE status-less saves touching different fields. The second must
    // build on the pending draft, not re-derive from the live row (which would
    // revert the first edit).
    await entries.updateEntry({ ...ctx, entryId: id }, { title: "draft-t" });
    await entries.updateEntry({ ...ctx, entryId: id }, { body: "draft-b" });

    // One coalesced draft holding BOTH edits.
    expect(await workingDraftCount(id)).toBe(1);
    const draftRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      includeWorkingDraft: true,
    });
    const data = draftRead.data as { title?: string; body?: string };
    expect(data.title).toBe("draft-t");
    expect(data.body).toBe("draft-b");

    // The live row is still fully untouched.
    const [live] = await handle!.adapter.select<LiveRow>(TABLE);
    expect(live.title).toBe("live-t");
    expect(live.body).toBe("live-b");
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

    // Draft view: the editor opts in to the working draft, so the overlay
    // returns the pending edit.
    const draftRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      includeWorkingDraft: true,
    });
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

  it("surfaces the working draft to an access-enforced authenticated editor, but not to an anonymous read", async () => {
    // A collection whose reads are access-enforced: only an authenticated caller
    // reads it, and everyone who reads it may also update it.
    handle = await createTestNextly({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          access: { read: () => true, update: () => true },
          fields: [text({ name: "title" }), text({ name: "body" })],
        }),
      ],
    });
    const entries = handle
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const trusted = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(trusted, { title: "live", status: "published" });
    const [row] = await handle.adapter.select<LiveRow>(TABLE);
    const id = row.id;
    await entries.updateEntry(
      { ...trusted, entryId: id },
      { title: "edited-in-draft" }
    );

    // An authenticated read with access enforced (no overrideAccess, no
    // routeAuthorized) that opts into the working draft — the Direct API editor
    // shape — surfaces the editor's own pending draft, because they can update
    // this (public) collection.
    const editorRead = await entries.getEntry({
      collectionName: COLLECTION,
      entryId: id,
      user: { id: "editor-1" },
      overrideAccess: false,
      includeWorkingDraft: true,
    });
    expect(editorRead.success).toBe(true);
    expect((editorRead.data as { title?: string }).title).toBe(
      "edited-in-draft"
    );

    // The SAME editor, but a status-less read WITHOUT the opt-in — the shape an
    // internal caller such as duplicate uses — gets the live row, never the
    // draft, so a duplicate copies published content.
    const internalRead = await entries.getEntry({
      collectionName: COLLECTION,
      entryId: id,
      user: { id: "editor-1" },
      overrideAccess: false,
    });
    expect((internalRead.data as { title?: string }).title).toBe("live");

    // An anonymous read (no user) never surfaces a draft even with the opt-in —
    // only the live row.
    const anonRead = await entries.getEntry({
      collectionName: COLLECTION,
      entryId: id,
      overrideAccess: false,
      includeWorkingDraft: true,
    });
    expect(anonRead.success).toBe(true);
    expect((anonRead.data as { title?: string }).title).toBe("live");
  });

  it("does not leak a draft to a read-only authenticated caller even with routeAuthorized", async () => {
    // Reads are allowed, updates are not: a read-only role.
    handle = await createTestNextly({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          access: { read: () => true, update: () => false },
          fields: [text({ name: "title" }), text({ name: "body" })],
        }),
      ],
    });
    const entries = handle
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService() as CollectionEntryService;

    await entries.createEntry(
      { collectionName: COLLECTION, overrideAccess: true },
      { title: "live", status: "published" }
    );
    const [row] = await handle.adapter.select<LiveRow>(TABLE);
    const id = row.id;
    await entries.updateEntry(
      { collectionName: COLLECTION, entryId: id, overrideAccess: true },
      { title: "edited-in-draft" }
    );

    // The REST dispatcher sets routeAuthorized from the READ authorization, so a
    // read-only authenticated caller arrives with routeAuthorized:true. Even
    // opting into the working draft, it must stay hidden because they cannot
    // update the document.
    const readerRead = await entries.getEntry({
      collectionName: COLLECTION,
      entryId: id,
      user: { id: "reader-1" },
      routeAuthorized: true,
      overrideAccess: false,
      includeWorkingDraft: true,
    });
    expect(readerRead.success).toBe(true);
    expect((readerRead.data as { title?: string }).title).toBe("live");
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

  it("requires publish permission to promote a draft on an already-published document", async () => {
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
    const handler = handle.getService<CollectionsHandler>("collectionsHandler");

    // Publish, then stash a pending draft via a trusted status-less edit.
    const created = await handler.createEntry(
      { collectionName: COLLECTION, overrideAccess: true },
      { title: "live-t", body: "live-b", status: "published" }
    );
    const id = (created.data as { id: string }).id;
    await handler.updateEntry(
      { collectionName: COLLECTION, entryId: id, overrideAccess: true },
      { title: "draft-t" }
    );
    expect(await workingDraftCount(id)).toBe(1);

    // A route-authorized user without publish permission "re-publishes" the
    // already-published row (a no-op status transition). Folding the draft is a
    // publish, so it must be denied and leave the draft intact — otherwise an
    // editor could push pending content live without publish permission.
    const denied = await handler.updateEntry(
      {
        collectionName: COLLECTION,
        entryId: id,
        userId: "user-no-publish",
        routeAuthorized: true,
      },
      { status: "published" }
    );
    expect(denied.success).toBe(false);
    expect(denied.statusCode).toBe(403);

    // Live content unchanged, the working draft still present.
    const [live] = await handle.adapter.select<LiveRow>(TABLE);
    expect(live.title).toBe("live-t");
    expect(live.body).toBe("live-b");
    expect(await workingDraftCount(id)).toBe(1);

    // A trusted publish still promotes it — the gate enforces the missing
    // permission, it does not blanket-block promotion.
    const allowed = await handler.updateEntry(
      { collectionName: COLLECTION, entryId: id, overrideAccess: true },
      { status: "published" }
    );
    expect(allowed.success).toBe(true);
    const [promoted] = await handle.adapter.select<LiveRow>(TABLE);
    expect(promoted.title).toBe("draft-t");
    expect(await workingDraftCount(id)).toBe(0);
  });
});
