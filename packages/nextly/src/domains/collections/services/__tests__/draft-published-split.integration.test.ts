import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  password,
  relationship,
  text,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";

// On a split-enabled collection (a draft/publish
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

  it("keeps the internal single-component tag out of a draft response and read but in the stored snapshot", async () => {
    handle = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({ slug: "hero", fields: [text({ name: "heading" })] }),
      ],
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "hero", component: "hero" }),
          ],
        }),
      ],
    });
    const entries = handle
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live",
      hero: { heading: "h1" },
      status: "published",
    });
    const [row] = await handle.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // A status-less edit of the single-component field.
    const res = await entries.updateEntry(
      { ...ctx, entryId: id },
      { hero: { heading: "h2" } }
    );
    const resHero = (res.data as { hero?: Record<string, unknown> }).hero;
    expect(resHero?.heading).toBe("h2");
    // The mutation response omits the internal single-component marker that a
    // dynamic zone would carry but an ordinary read of a single component does not.
    expect(resHero && "_componentType" in resHero).toBe(false);

    // The draft read overlay omits it too.
    const draftRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      includeWorkingDraft: true,
    });
    const readHero = (draftRead.data as { hero?: Record<string, unknown> })
      .hero;
    expect(readHero?.heading).toBe("h2");
    expect(readHero && "_componentType" in readHero).toBe(false);

    // The STORED snapshot retains the marker so a promote can still resolve the
    // component's schema even if the field is later retargeted.
    const [draftRow] = await handle.adapter.select<{
      snapshot: { hero?: Record<string, unknown> };
    }>("nextly_versions", {
      where: {
        and: [
          { column: "entryId", op: "=", value: id },
          { column: "versionNo", op: "IS NULL" },
          { column: "status", op: "=", value: "draft" },
        ],
      },
    });
    expect(draftRow.snapshot.hero?._componentType).toBe("hero");
  });

  it("does not fold or delete a working draft when restoring a version", async () => {
    const entries = await boot();
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live",
      body: "b",
      status: "published",
    });
    const [row] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // A pending draft edit.
    await entries.updateEntry({ ...ctx, entryId: id }, { title: "drafted" });
    expect(await workingDraftCount(id)).toBe(1);

    // A restore write names a status and carries sourceVersionNo. It must apply
    // the restore payload directly, not fold the unrelated pending draft into
    // the live row, and must leave the draft in place rather than deleting it.
    const restore = await entries.updateEntry(
      { ...ctx, entryId: id, sourceVersionNo: 1 },
      { title: "restored", body: "b", status: "published" }
    );
    expect(restore.success).toBe(true);

    // The live row is the restored payload, not the draft's "drafted" title.
    const [live] = await handle!.adapter.select<LiveRow>(TABLE);
    expect(live.title).toBe("restored");
    // The pending draft survived the restore.
    expect(await workingDraftCount(id)).toBe(1);
  });

  it("expands relationships inside a draft component at depth > 0", async () => {
    handle = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({
          slug: "linker",
          fields: [relationship({ name: "rel", relationTo: "tags" })],
        }),
      ],
      collections: [
        defineCollection({ slug: "tags", fields: [text({ name: "name" })] }),
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "linker", component: "linker" }),
          ],
        }),
      ],
    });
    const entries = handle
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    const tag = await entries.createEntry(
      { collectionName: "tags", overrideAccess: true },
      { name: "t1" }
    );
    const tagId = (tag.data as { id: string }).id;

    await entries.createEntry(ctx, {
      title: "live",
      linker: { rel: tagId },
      status: "published",
    });
    const [row] = await handle.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // A status-less edit stores the component in the draft snapshot with its
    // relation captured as an id.
    await entries.updateEntry({ ...ctx, entryId: id }, { title: "drafted" });

    // A draft read at depth 1 must expand the relation inside the component, like
    // a live read, rather than leaving it a bare id.
    const draftRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      includeWorkingDraft: true,
      depth: 1,
    });
    const linker = (draftRead.data as { linker?: { rel?: unknown } }).linker;
    const rel = linker?.rel;
    expect(rel !== null && typeof rel === "object").toBe(true);
    expect((rel as { name?: string })?.name).toBe("t1");
  });

  it("keeps a status-less edit live (no draft) when the collection has a password field", async () => {
    handle = await createTestNextly({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [text({ name: "title" }), password({ name: "secret" })],
        }),
      ],
    });
    const entries = handle
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live",
      secret: "s3cret-value",
      status: "published",
    });
    const [row] = await handle.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // A password field cannot ride safely in a working draft, so the collection
    // is ineligible for the split and a status-less edit writes the live row
    // directly rather than storing a draft.
    const res = await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "edited" }
    );
    expect(res.success).toBe(true);

    const [live] = await handle.adapter.select<LiveRow>(TABLE);
    expect(live.title).toBe("edited");
    expect(await workingDraftCount(id)).toBe(0);
  });

  it("accumulates disjoint sub-field edits of a single component across draft saves", async () => {
    handle = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({
          slug: "seo",
          fields: [text({ name: "metaTitle" }), text({ name: "metaDesc" })],
        }),
      ],
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "seo", component: "seo" }),
          ],
        }),
      ],
    });
    const entries = handle
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live",
      seo: { metaTitle: "live-title", metaDesc: "live-desc" },
      status: "published",
    });
    const [row] = await handle.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // Two draft saves each touching a DIFFERENT sub-field of the same component.
    await entries.updateEntry(
      { ...ctx, entryId: id },
      { seo: { metaTitle: "draft-title" } }
    );
    await entries.updateEntry(
      { ...ctx, entryId: id },
      { seo: { metaDesc: "draft-desc" } }
    );
    expect(await workingDraftCount(id)).toBe(1);

    // Both pending sub-field edits survive on the coalesced draft.
    const draftRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      includeWorkingDraft: true,
    });
    const seo = (
      draftRead.data as { seo?: { metaTitle?: string; metaDesc?: string } }
    ).seo;
    expect(seo?.metaTitle).toBe("draft-title");
    expect(seo?.metaDesc).toBe("draft-desc");
  });

  it("does not promote a draft field the publisher's field-level access denies", async () => {
    handle = await createTestNextly({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          access: {
            read: () => true,
            update: () => true,
            publish: () => true,
          },
          fields: [
            text({ name: "title" }),
            text({
              name: "secret",
              access: {
                update: (args: { req?: { user?: { id?: string } } }) =>
                  args.req?.user?.id === "admin",
              },
            }),
          ],
        }),
      ],
    });
    const entries = handle
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService() as CollectionEntryService;

    // Seed a published row with a secret, via a trusted context.
    await entries.createEntry(
      { collectionName: COLLECTION, overrideAccess: true },
      { title: "live", secret: "live-secret", status: "published" }
    );
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    // A trusted draft edit changes BOTH the title and the restricted secret.
    await entries.updateEntry(
      { collectionName: COLLECTION, entryId: id, overrideAccess: true },
      { title: "draft-title", secret: "draft-secret" }
    );

    // A non-admin editor publishes: field-level write access denies "secret".
    const res = await entries.updateEntry(
      {
        collectionName: COLLECTION,
        entryId: id,
        user: { id: "editor" },
        overrideAccess: false,
      },
      { status: "published" }
    );
    expect(res.success).toBe(true);

    const [live] = await handle.adapter.select<{
      title: string;
      secret: string;
    }>(TABLE);
    // The allowed field is promoted...
    expect(live.title).toBe("draft-title");
    // ...but the field the publisher may not write keeps its live value.
    expect(live.secret).toBe("live-secret");
  });
});

// The split coalesces a working draft under one unlocalized slot and promotes it
// as plain columns, so it is only safe on a collection whose reachable component
// schemas are all resolvable and non-localized. These cases cover the schema
// changing AFTER a draft was written (a field dropped, a component turning
// localized), which the write gate and the read overlay must both react to.
describe("draft/published split — schema and component eligibility (integration)", () => {
  let dir: string;
  let dbPath: string;
  // createTestNextly snapshots DB_DIALECT when it builds an adapter; these tests
  // build their own adapter first, so the prior value is restored to keep the
  // single-fork run from resolving later files' schema behaviour as SQLite.
  let previousDialect: string | undefined;

  beforeEach(() => {
    previousDialect = process.env.DB_DIALECT;
    dir = mkdtempSync(join(tmpdir(), "nextly-draft-split-"));
    dbPath = join(dir, "test.db");
  });

  afterEach(() => {
    if (previousDialect === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = previousDialect;
    rmSync(dir, { recursive: true, force: true });
  });

  // A file-backed SQLite boot so a second boot on the same path sees the rows
  // (and the working draft) the first boot wrote, with a changed schema.
  async function bootFile(
    opts: Parameters<typeof createTestNextly>[0]
  ): Promise<CollectionEntryService> {
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      url: `file:${dbPath}`,
    } as Parameters<typeof createAdapter>[0]);
    handle = await createTestNextly({ ...opts, adapter });
    return handle
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService() as CollectionEntryService;
  }

  const localization = { locales: ["en", "es"], defaultLocale: "en" };

  const withHero = (
    heroLocalized: boolean
  ): Parameters<typeof createTestNextly>[0] => ({
    localization,
    fieldGroups: [
      defineFieldGroup({
        slug: "hero",
        localized: heroLocalized,
        fields: [text({ name: "heading" })],
      }),
    ],
    collections: [
      defineCollection({
        slug: COLLECTION,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "hero", component: "hero" }),
        ],
      }),
    ],
  });

  it("keeps a status-less edit live (no draft) when the collection embeds a localized component", async () => {
    const entries = await bootFile(withHero(true));
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [row] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // A localized component makes the collection ineligible for the split, so a
    // status-less edit writes the live row directly rather than storing a draft.
    const res = await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "edited" }
    );
    expect(res.success).toBe(true);

    const [live] = await handle!.adapter.select<LiveRow>(TABLE);
    expect(live.title).toBe("edited");
    expect(await workingDraftCount(id)).toBe(0);
  });

  it("prunes fields the current schema no longer declares from a draft read", async () => {
    const entries = await bootFile({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title" }),
            text({ name: "body" }),
            text({ name: "subtitle" }),
          ],
        }),
      ],
    });
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [row] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // Store a draft that carries `subtitle`, then drop `subtitle` from the schema.
    await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "draft-title", subtitle: "pending" }
    );
    await handle!.destroy();
    handle = undefined;

    const reopened = await bootFile({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [text({ name: "title" }), text({ name: "body" })],
        }),
      ],
    });

    const draftRead = await reopened.getEntry({
      collectionName: COLLECTION,
      entryId: id,
      overrideAccess: true,
      includeWorkingDraft: true,
    });
    const data = draftRead.data as Record<string, unknown>;
    // The draft is still surfaced...
    expect(data.title).toBe("draft-title");
    // ...but the field the schema no longer declares does not leak through.
    expect("subtitle" in data).toBe(false);
  });

  it("stops overlaying the draft when an embedded component becomes localized after the draft was written", async () => {
    const entries = await bootFile(withHero(false));
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [row] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // Non-localized component: the split is on, so a status-less edit stores a draft.
    await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "draft-title" }
    );
    expect(await workingDraftCount(id)).toBe(1);

    await handle!.destroy();
    handle = undefined;

    // Re-open with the component now localized: no write can consume the sidecar
    // (the mutation path stopped promoting and deleting it), so the read overlay
    // must fall back to the live row rather than shadow it with a stale draft.
    const reopened = await bootFile(withHero(true));

    const draftRead = await reopened.getEntry({
      collectionName: COLLECTION,
      entryId: id,
      overrideAccess: true,
      includeWorkingDraft: true,
    });
    expect((draftRead.data as { title?: string }).title).toBe("live");
  });

  it("rejects a publish when the pending draft violates a tightened schema rule", async () => {
    const entries = await bootFile({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [text({ name: "title" }), text({ name: "subtitle" })],
        }),
      ],
    });
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live",
      subtitle: "initial",
      status: "published",
    });
    const [row] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // Draft a short subtitle, then tighten the schema to require a longer one.
    await entries.updateEntry({ ...ctx, entryId: id }, { subtitle: "ab" });
    expect(await workingDraftCount(id)).toBe(1);
    await handle!.destroy();
    handle = undefined;

    const reopened = await bootFile({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title" }),
            text({ name: "subtitle", minLength: 5 }),
          ],
        }),
      ],
    });

    // Publishing folds the draft (subtitle "ab") into the live write; the value
    // now violates minLength, so the promote is rejected rather than publishing
    // an invalid document.
    const res = await reopened.updateEntry(
      { ...ctx, entryId: id },
      { status: "published" }
    );
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(400);

    // The draft survives (the transaction rolled back), so the pending edit is
    // not lost by a rejected publish.
    expect(await workingDraftCount(id)).toBe(1);
  });

  it("invalidates a stale working draft when drafts are turned off", async () => {
    const entries = await bootFile({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [row] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // Store a working draft while the split is enabled.
    await entries.updateEntry({ ...ctx, entryId: id }, { title: "drafted" });
    expect(await workingDraftCount(id)).toBe(1);
    await handle!.destroy();
    handle = undefined;

    // Re-open with drafts turned off: a status-less edit writes the live row
    // directly and must invalidate the now-unpromotable sidecar so re-enabling
    // drafts later cannot resurrect it over the intervening live edits.
    const reopened = await bootFile({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: false },
          fields: [text({ name: "title" })],
        }),
      ],
    });

    const res = await reopened.updateEntry(
      { ...ctx, entryId: id },
      { title: "live-edit" }
    );
    expect(res.success).toBe(true);

    const [live] = await handle!.adapter.select<LiveRow>(TABLE);
    expect(live.title).toBe("live-edit");
    expect(await workingDraftCount(id)).toBe(0);
  });
});
