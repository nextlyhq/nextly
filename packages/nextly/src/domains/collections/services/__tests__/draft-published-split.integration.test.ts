import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  date,
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  group,
  password,
  relationship,
  text,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { discardWorkingDraftForDocument } from "../../../../dispatcher/handlers/versions-methods";
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
    .getService("collectionsHandler")
    .getEntryService() as CollectionEntryService;
}

type LiveRow = { id: string; title: string; body: string; status: string };
type VersionRow = {
  snapshot: { title?: string; body?: string };
  status: string;
  versionNo: number | null;
};

async function workingDraftLocales(id: string): Promise<string[]> {
  const rows = await handle!.adapter.select<
    VersionRow & { locale: string | null }
  >("nextly_versions", {
    where: {
      and: [
        { column: "entryId", op: "=", value: id },
        { column: "isAutosave", op: "=", value: false },
        { column: "versionNo", op: "IS NULL" },
        { column: "status", op: "=", value: "draft" },
      ],
    },
  });
  return rows.map(r => r.locale ?? "").sort();
}

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

    // Explicit status=draft view WITH the opt-in: the live row stays published,
    // so the draft-only status filter must not 404 before the overlay runs.
    const draftStatusRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      status: "draft",
      includeWorkingDraft: true,
    });
    expect(draftStatusRead.success).toBe(true);
    expect((draftStatusRead.data as { title?: string }).title).toBe(
      "edited-in-draft"
    );
  });

  it("flags the working draft with _isWorkingDraft on the save response and the draft read, but never the live row", async () => {
    // The editor UI derives a "Changed / unpublished edits" state from this flag
    // rather than from `status` (which the overlay keeps at the live parent's
    // published value).
    const entries = await boot();
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [row] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // A status-less save stores a working draft — its response carries the flag.
    const saveRes = await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "edited-in-draft" }
    );
    expect(
      (saveRes.data as { _isWorkingDraft?: boolean })._isWorkingDraft
    ).toBe(true);

    // The trusted draft-view read carries the flag.
    const draftRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      includeWorkingDraft: true,
    });
    expect(
      (draftRead.data as { _isWorkingDraft?: boolean })._isWorkingDraft
    ).toBe(true);

    // The published-view read returns the live row, which must NOT be flagged.
    const publishedRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      status: "published",
    });
    expect(
      (publishedRead.data as { _isWorkingDraft?: boolean })._isWorkingDraft
    ).toBeUndefined();

    // A publish promotes the draft to the live row; that live-write response is
    // NOT a working draft, so it must not be flagged.
    const publishRes = await entries.updateEntry(
      { ...ctx, entryId: id },
      { status: "published" }
    );
    expect(
      (publishRes.data as { _isWorkingDraft?: boolean })._isWorkingDraft
    ).toBeUndefined();
  });

  it("makes the working draft reachable through the Direct API findByID draft option", async () => {
    // End-to-end reachability: the split engine's read overlay is dormant unless
    // a caller-facing surface forwards the opt-in. This drives the full
    // Direct API -> handler -> entry service -> query service chain.
    const entries = await boot();
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [row] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // Stash a pending edit as the working draft (a trusted status-less save).
    await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "edited-in-draft" }
    );

    // A plain findByID returns the live published row.
    const live = await handle!.nextly.findByID({
      collection: COLLECTION,
      id,
      overrideAccess: true,
    });
    expect((live as { title?: string } | null)?.title).toBe("live");

    // The `draft: true` opt-in surfaces the pending working draft instead.
    const draft = await handle!.nextly.findByID({
      collection: COLLECTION,
      id,
      draft: true,
      overrideAccess: true,
    });
    expect((draft as { title?: string } | null)?.title).toBe("edited-in-draft");
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
      .getService("collectionsHandler")
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
      .getService("collectionsHandler")
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

// Discarding a pending working draft throws away the unpublished edits and
// reverts the editor to the live published row. It is authorized as an update
// of the document — a caller who may not update it may not discard its pending
// edits — and it never touches the durable history.
describe("draft/published split — discard working draft (integration)", () => {
  it("removes the sidecar and returns the live published row for an editor who may update", async () => {
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
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const trusted = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(trusted, { title: "live", status: "published" });
    const [row] = await handle.adapter.select<LiveRow>(TABLE);
    const id = row.id;
    // A status-less edit stores a working draft over the published row.
    await entries.updateEntry(
      { ...trusted, entryId: id },
      { title: "edited-in-draft" }
    );
    expect(await workingDraftCount(id)).toBe(1);

    const discarded = await discardWorkingDraftForDocument({
      scopeKind: "collection",
      slug: COLLECTION,
      entryId: id,
      user: { id: "editor-1" },
      params: {
        collectionName: COLLECTION,
        entryId: id,
        _authenticatedUserId: "editor-1",
      },
    });

    // The sidecar is gone...
    expect(await workingDraftCount(id)).toBe(0);
    // ...and the response is the live published row, not the discarded edit.
    expect((discarded as { title?: string }).title).toBe("live");
    expect((discarded as { status?: string }).status).toBe("published");
    // The live row itself was never touched.
    const [liveAfter] = await handle.adapter.select<LiveRow>(TABLE);
    expect(liveAfter.title).toBe("live");
    expect(liveAfter.status).toBe("published");
  });

  it("refuses to discard for a caller who may not read the document, leaving the sidecar", async () => {
    // Reads are denied for this caller. Discard is authorized as an update, but
    // it re-establishes read first and refuses as not-found so the response does
    // not confirm the document exists — and the pending draft is left intact.
    // (The update-gate refusal, a 403 for a reader who may see but not edit the
    // document, is pinned at the handler in discard-working-draft-access.test.)
    handle = await createTestNextly({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          access: { read: () => false },
          fields: [text({ name: "title" }), text({ name: "body" })],
        }),
      ],
    });
    const entries = handle
      .getService("collectionsHandler")
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
    expect(await workingDraftCount(id)).toBe(1);

    await expect(
      discardWorkingDraftForDocument({
        scopeKind: "collection",
        slug: COLLECTION,
        entryId: id,
        user: { id: "reader-1" },
        params: {
          collectionName: COLLECTION,
          entryId: id,
          _authenticatedUserId: "reader-1",
        },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The pending draft survives a refused discard.
    expect(await workingDraftCount(id)).toBe(1);
  });

  it("removes the sidecar through the handler's locked discard, leaving the live row untouched", async () => {
    // The handler-level method the discard endpoint calls once it has authorized
    // read and update: it deletes the sidecar under the parent-row lock (a no-op
    // lock on SQLite, which serializes writers) and takes no user of its own.
    handle = await createTestNextly({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          access: { read: () => true, update: () => true },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;
    const trusted = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(trusted, { title: "live", status: "published" });
    const [row] = await handle.adapter.select<LiveRow>(TABLE);
    const id = row.id;
    await entries.updateEntry(
      { ...trusted, entryId: id },
      { title: "edited-in-draft" }
    );
    expect(await workingDraftCount(id)).toBe(1);

    await handler.discardWorkingDraft({
      collectionName: COLLECTION,
      entryId: id,
    });

    expect(await workingDraftCount(id)).toBe(0);
    const [liveAfter] = await handle.adapter.select<LiveRow>(TABLE);
    expect(liveAfter.title).toBe("live");
    expect(liveAfter.status).toBe("published");
  });

  it("discards only the language it was asked for, leaving other languages' pending changes", async () => {
    // A localized document holds one pending change per language, so a discard
    // is one language's concern. Throwing away a language the author never
    // opened destroys work nobody asked to lose, and leaving the language they
    // DID ask about means the editor still shows the edit it just reported
    // discarding.
    handle = await createTestNextly({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          localized: true,
          versions: { drafts: true },
          access: { read: () => true, update: () => true },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const entries = handle
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const trusted = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(trusted, {
      title: "live-en",
      status: "published",
    });
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    // A pending change in each language. The English save names no locale,
    // which is the admin's ordinary path for the default language.
    await entries.updateEntry(
      { ...trusted, entryId: id },
      { title: "edited-en" }
    );
    await entries.updateEntry(
      { ...trusted, entryId: id, locale: "es" },
      { title: "edited-es" }
    );
    expect(await workingDraftLocales(id)).toEqual(["en", "es"]);

    // The editor is on Spanish and discards. The request names that language.
    await discardWorkingDraftForDocument({
      scopeKind: "collection",
      slug: COLLECTION,
      entryId: id,
      user: { id: "editor-1" },
      locale: "es",
      params: {
        collectionName: COLLECTION,
        entryId: id,
        _authenticatedUserId: "editor-1",
      },
    });

    // Spanish is gone and English survives untouched.
    expect(await workingDraftLocales(id)).toEqual(["en"]);
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
    const handler = handle.getService("collectionsHandler");

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
      .getService("collectionsHandler")
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

  it("drops the working draft when a restore lands a non-published status", async () => {
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
    const entries = handle
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live",
      body: "b",
      status: "published",
    });
    const [row] = await handle.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // A pending draft edit over the published row.
    await entries.updateEntry({ ...ctx, entryId: id }, { title: "drafted" });
    expect(await workingDraftCount(id)).toBe(1);

    // A restore that lands a non-published status turns the live row into a draft,
    // breaking the working-draft invariant (a sidecar is pending edits OVER a
    // published row). The restore does not fold the sidecar, so leaving it would
    // let editor reads overlay stale edits and a later publish promote them over
    // the restored content. It must be dropped.
    const restore = await entries.updateEntry(
      { ...ctx, entryId: id, sourceVersionNo: 1 },
      { title: "restored", body: "b", status: "draft" }
    );
    expect(restore.success).toBe(true);

    const [live] = await handle.adapter.select<LiveRow>(TABLE);
    expect(live.title).toBe("restored");
    expect(await workingDraftCount(id)).toBe(0);
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
      .getService("collectionsHandler")
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
      .getService("collectionsHandler")
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
      .getService("collectionsHandler")
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
      .getService("collectionsHandler")
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

  it("does not promote a denied field nested in a group", async () => {
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
            group({
              name: "meta",
              fields: [
                text({ name: "note" }),
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
        }),
      ],
    });
    const entries = handle
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;

    await entries.createEntry(
      { collectionName: COLLECTION, overrideAccess: true },
      {
        title: "live",
        meta: { note: "live-note", secret: "live-secret" },
        status: "published",
      }
    );
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    // A trusted draft edit changes both the allowed and the restricted nested field.
    await entries.updateEntry(
      { collectionName: COLLECTION, entryId: id, overrideAccess: true },
      { meta: { note: "draft-note", secret: "draft-secret" } }
    );

    // A non-admin editor publishes: field access denies the NESTED meta.secret.
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

    const [live] = await handle.adapter.select<{ meta: unknown }>(TABLE);
    const meta = (
      typeof live.meta === "string" ? JSON.parse(live.meta) : live.meta
    ) as { note?: string; secret?: string };
    // The allowed nested field is promoted...
    expect(meta.note).toBe("draft-note");
    // ...but the denied nested field's pending value is NOT published.
    expect(meta.secret).not.toBe("draft-secret");
  });

  it("re-evaluates a draft field's access against a sibling changed by the publish patch", async () => {
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
            text({ name: "approved" }),
            text({
              name: "secret",
              // Writable only while its sibling `approved` is "yes".
              access: {
                update: (args: { data?: { approved?: unknown } }) =>
                  args.data?.approved === "yes",
              },
            }),
          ],
        }),
      ],
    });
    const entries = handle
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;

    await entries.createEntry(
      { collectionName: COLLECTION, overrideAccess: true },
      {
        title: "live",
        approved: "no",
        secret: "live-secret",
        status: "published",
      }
    );
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    // A trusted draft sets approved=yes and the (then-writable) secret.
    await entries.updateEntry(
      { collectionName: COLLECTION, entryId: id, overrideAccess: true },
      { approved: "yes", secret: "draft-secret" }
    );

    // A non-override editor publishes AND flips approved back to "no" in the same
    // patch: the gated secret must be re-denied against that final value, not the
    // draft's stale sibling.
    const res = await entries.updateEntry(
      {
        collectionName: COLLECTION,
        entryId: id,
        user: { id: "editor" },
        overrideAccess: false,
      },
      { status: "published", approved: "no" }
    );
    expect(res.success).toBe(true);

    const [live] = await handle.adapter.select<{
      approved: string;
      secret: string;
    }>(TABLE);
    expect(live.approved).toBe("no");
    expect(live.secret).not.toBe("draft-secret");
  });

  it("does not promote a caller's component value a field-access rule denies", async () => {
    // The scalar case above is caught by the merged access pass, but a component
    // (and m2m) value is EXTRACTED out of the caller payload before promotion, so
    // it must be folded back into the access-checked document or the caller's copy
    // is persisted after the pass denies the draft's copy.
    handle = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({ slug: "promo", fields: [text({ name: "label" })] }),
      ],
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
            text({ name: "approved" }),
            fieldGroup({
              name: "promo",
              component: "promo",
              // Denied only when its sibling `approved` is explicitly "no", so a
              // publish that omits `approved` passes the caller-payload gate while
              // the pending draft's `approved: "no"` must still deny it.
              access: {
                update: (args: { data?: { approved?: unknown } }) =>
                  args.data?.approved !== "no",
              },
            }),
          ],
        }),
      ],
    });
    const entries = handle
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;

    await entries.createEntry(
      { collectionName: COLLECTION, overrideAccess: true },
      { approved: "yes", promo: { label: "live" }, status: "published" }
    );
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    // A trusted draft sets approved="no" (which denies promo) and stages a promo.
    await entries.updateEntry(
      { collectionName: COLLECTION, entryId: id, overrideAccess: true },
      { approved: "no", promo: { label: "draft" } }
    );

    // A non-override editor publishes, carrying a new promo but NOT `approved`: the
    // caller-payload gate allows promo (approved absent), but the merged document
    // carries the draft's `approved: "no"`, so the extracted component must be
    // re-denied against that final value and NOT promoted.
    const res = await entries.updateEntry(
      {
        collectionName: COLLECTION,
        entryId: id,
        user: { id: "editor" },
        overrideAccess: false,
      },
      { status: "published", promo: { label: "caller" } }
    );
    expect(res.success).toBe(true);

    const readBack = await entries.getEntry({
      collectionName: COLLECTION,
      entryId: id,
      overrideAccess: true,
    });
    expect((readBack.data as { approved?: string }).approved).toBe("no");
    const promo = (readBack.data as { promo?: { label?: string } }).promo;
    expect(promo?.label).toBe("live");
  });

  it("returns the pending change to an explicit draft view of a LOCALIZED document", async () => {
    // The draft-status read and the overlay must agree about what is eligible.
    // A second, hand-rolled copy of the predicate decided whether to suppress
    // the draft-only filter on the live row, and it still excluded a localized
    // document — so the query filtered a PUBLISHED main row to `status = draft`,
    // matched nothing, and answered 404 before the overlay could run. The write
    // had held the edit; the read said the document did not exist.
    handle = await createTestNextly({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          localized: true,
          versions: { drafts: true },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const entries = handle
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    await entries.updateEntry({ ...ctx, entryId: id }, { title: "edited" });
    expect(await workingDraftCount(id)).toBe(1);

    const draftView = await entries.getEntry({
      ...ctx,
      entryId: id,
      includeWorkingDraft: true,
      status: "draft",
      locale: "en",
    });

    expect(draftView.success).toBe(true);
    expect((draftView.data as { title?: string }).title).toBe("edited");
  });

  it("holds a localized edit that names no language, under the default", async () => {
    // A localized document IS eligible for the split, including one whose
    // schema references a component: a snapshot holds one locale's values and
    // the draft is keyed by that locale. A request naming no locale is the
    // admin's ordinary path for the default language, and its pending change
    // keys under the default rather than being refused.
    handle = await createTestNextly({
      localization: { locales: ["en", "es"], defaultLocale: "en" },
      fieldGroups: [
        defineFieldGroup({ slug: "promo", fields: [text({ name: "label" })] }),
      ],
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          localized: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "promo", component: "promo" }),
          ],
        }),
      ],
    });
    const entries = handle
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    const res = await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "edited" }
    );
    expect(res.success).toBe(true);
    expect(await workingDraftCount(id)).toBe(1);
    // A localized collection keeps its text per locale, so read the live value
    // back through getEntry rather than the main row. The live translation is
    // untouched: the edit is held, not published.
    const read = await entries.getEntry({ ...ctx, entryId: id, locale: "en" });
    expect((read.data as { title?: string }).title).toBe("live");
  });

  it("keeps a live single component's other sub-fields on a first partial draft save", async () => {
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
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live",
      seo: { metaTitle: "live-title", metaDesc: "live-desc" },
      status: "published",
    });
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    // The FIRST status-less save changes only seo.metaTitle. With no sidecar yet,
    // the draft must still keep the live seo.metaDesc rather than dropping it.
    await entries.updateEntry(
      { ...ctx, entryId: id },
      { seo: { metaTitle: "draft-title" } }
    );

    const draftRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      includeWorkingDraft: true,
    });
    const seo = (
      draftRead.data as { seo?: { metaTitle?: string; metaDesc?: string } }
    ).seo;
    expect(seo?.metaTitle).toBe("draft-title");
    expect(seo?.metaDesc).toBe("live-desc");
  });

  it("404s a status=draft read when no working draft exists", async () => {
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
    const entries = handle
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    // No draft was ever saved. A status=draft read that opts into the working
    // draft must not fall back to the published row; it 404s like the filter would.
    const res = await entries.getEntry({
      ...ctx,
      entryId: id,
      status: "draft",
      includeWorkingDraft: true,
    });
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(404);
  });

  it("returns a never-published draft row for a status=draft read", async () => {
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
    const entries = handle
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "draft-only", status: "draft" });
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    // The main row is itself a draft (never published), so it matches the filter
    // directly and must be returned rather than 404'd by the working-draft opt-in.
    const res = await entries.getEntry({
      ...ctx,
      entryId: id,
      status: "draft",
      includeWorkingDraft: true,
    });
    expect(res.success).toBe(true);
    expect((res.data as { title?: string }).title).toBe("draft-only");
  });

  it("gives afterUpdate the prior working draft as originalData on a repeat save", async () => {
    const seen: unknown[] = [];
    handle = await createTestNextly({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          hooks: {
            // Config `afterChange` maps to the runtime `afterUpdate` phase.
            afterChange: [
              ctx => {
                seen.push(ctx.originalData);
              },
            ],
          },
          fields: [text({ name: "title" }), text({ name: "body" })],
        }),
      ],
    });
    const entries = handle
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live",
      body: "b",
      status: "published",
    });
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    // The first status-less save stores the draft (title becomes draft1).
    await entries.updateEntry({ ...ctx, entryId: id }, { title: "draft1" });
    // The second save touches only body. The afterUpdate hook's originalData must
    // be the PRIOR draft (title=draft1), not the unchanged published row.
    seen.length = 0;
    await entries.updateEntry({ ...ctx, entryId: id }, { body: "b2" });

    expect(seen).toHaveLength(1);
    expect((seen[0] as { title?: string }).title).toBe("draft1");
  });

  it("deletes the working-draft sidecar when the entry is deleted", async () => {
    const entries = await boot();
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [row] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // A pending draft leaves a sidecar in nextly_versions.
    await entries.updateEntry({ ...ctx, entryId: id }, { title: "drafted" });
    expect(await workingDraftCount(id)).toBe(1);

    // Deleting the entry must remove the sidecar too, not orphan it.
    const deleted = await entries.deleteEntry({ ...ctx, entryId: id });
    expect(deleted.success).toBe(true);
    expect(await workingDraftCount(id)).toBe(0);
  });

  it("recursively merges nested single-component sub-field edits across draft saves", async () => {
    handle = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({
          slug: "social",
          fields: [text({ name: "twitter" }), text({ name: "facebook" })],
        }),
        defineFieldGroup({
          slug: "seo",
          fields: [
            text({ name: "metaTitle" }),
            fieldGroup({ name: "social", component: "social" }),
          ],
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
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    const created = await entries.createEntry(ctx, {
      title: "live",
      status: "published",
    });
    expect(created.success).toBe(true);
    const id = (created.data as { id: string }).id;

    // Two saves each touching a DIFFERENT field of the DEEPLY NESTED component.
    await entries.updateEntry(
      { ...ctx, entryId: id },
      { seo: { social: { twitter: "draft-tw" } } }
    );
    await entries.updateEntry(
      { ...ctx, entryId: id },
      { seo: { social: { facebook: "draft-fb" } } }
    );

    const draftRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      includeWorkingDraft: true,
    });
    const social = (
      draftRead.data as {
        seo?: { social?: { twitter?: string; facebook?: string } };
      }
    ).seo?.social;
    expect(social?.twitter).toBe("draft-tw");
    expect(social?.facebook).toBe("draft-fb");
  });

  it("merges a partial component publish patch into the promoted draft", async () => {
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
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live",
      seo: { metaTitle: "live-mt", metaDesc: "live-md" },
      status: "published",
    });
    const [row] = await handle.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // A draft edit changes one sub-field of the component.
    await entries.updateEntry(
      { ...ctx, entryId: id },
      { seo: { metaTitle: "draft-mt" } }
    );

    // Publish sends a partial patch for a DIFFERENT sub-field. The pending edit
    // and the publish patch must both reach the live row.
    await entries.updateEntry(
      { ...ctx, entryId: id },
      { status: "published", seo: { metaDesc: "pub-md" } }
    );

    const liveRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      status: "published",
    });
    const seo = (
      liveRead.data as { seo?: { metaTitle?: string; metaDesc?: string } }
    ).seo;
    expect(seo?.metaTitle).toBe("draft-mt");
    expect(seo?.metaDesc).toBe("pub-md");
  });

  it("rehydrates date fields to Date objects on a draft read", async () => {
    handle = await createTestNextly({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [text({ name: "title" }), date({ name: "publishAt" })],
        }),
      ],
    });
    const entries = handle
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live",
      publishAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "published",
    });
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    await entries.updateEntry(
      { ...ctx, entryId: id },
      { publishAt: new Date("2026-06-15T00:00:00.000Z") }
    );

    const draftRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      includeWorkingDraft: true,
    });
    // The snapshot stores the date as an ISO string; the overlay must rehydrate
    // it to a Date, matching a live read (whose afterRead hooks receive Dates).
    const publishAt = (draftRead.data as { publishAt?: unknown }).publishAt;
    expect(publishAt instanceof Date).toBe(true);
    expect((publishAt as Date).toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("rehydrates date fields nested inside a draft component", async () => {
    handle = await createTestNextly({
      fieldGroups: [
        defineFieldGroup({
          slug: "event",
          fields: [text({ name: "name" }), date({ name: "startsAt" })],
        }),
      ],
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title" }),
            fieldGroup({ name: "event", component: "event" }),
          ],
        }),
      ],
    });
    const entries = handle
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live",
      event: { name: "launch", startsAt: new Date("2026-03-01T00:00:00.000Z") },
      status: "published",
    });
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    await entries.updateEntry(
      { ...ctx, entryId: id },
      { event: { startsAt: new Date("2026-09-09T00:00:00.000Z") } }
    );

    const draftRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      includeWorkingDraft: true,
    });
    // The date nested in the component comes back as a Date, like a live read.
    const startsAt = (draftRead.data as { event?: { startsAt?: unknown } })
      .event?.startsAt;
    expect(startsAt instanceof Date).toBe(true);
  });

  it("returns dates as Date objects when a reused draft leaves them untouched", async () => {
    handle = await createTestNextly({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [text({ name: "title" }), date({ name: "publishAt" })],
        }),
      ],
    });
    const entries = handle
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, {
      title: "live",
      publishAt: new Date("2026-01-01T00:00:00.000Z"),
      status: "published",
    });
    const [row] = await handle.adapter.select<{ id: string }>(TABLE);
    const id = row.id;

    // The first status-less save stores the working draft (the date becomes JSON).
    await entries.updateEntry({ ...ctx, entryId: id }, { title: "draft one" });
    // The second save reuses that draft. `publishAt` is untouched, so it is read
    // back from the JSON snapshot as a string; the response and the afterUpdate
    // hooks must still see a Date, matching an ordinary update.
    const res = await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "draft two" }
    );

    const publishAt = (res.data as { publishAt?: unknown }).publishAt;
    expect(publishAt instanceof Date).toBe(true);
    expect((publishAt as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
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
      .getService("collectionsHandler")
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

  it("holds a status-less edit when the collection embeds a localized component", async () => {
    const entries = await bootFile(withHero(true));
    const ctx = { collectionName: COLLECTION, overrideAccess: true };

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [row] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // A localized component is representable in a draft snapshot, which holds
    // exactly one locale's values and is keyed by that locale. What is still
    // refused is an UNRESOLVED component, whose subtree would be dropped on
    // promote without anyone noticing.
    const res = await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "edited" }
    );
    expect(res.success).toBe(true);

    const [live] = await handle!.adapter.select<LiveRow>(TABLE);
    expect(live.title).toBe("live");
    expect(await workingDraftCount(id)).toBe(1);

    // The half the assertions above cannot reach: a held edit the author can
    // never see is lost in the worst way, because the save reported success.
    // "The live row is untouched" is satisfied just as well by a system that
    // stored nothing, so the draft VIEW has to be asserted too.
    const draftRead = await entries.getEntry({
      ...ctx,
      entryId: id,
      includeWorkingDraft: true,
      status: "all",
    });
    expect(draftRead.success).toBe(true);
    expect((draftRead.data as { title?: string }).title).toBe("edited");
    expect(
      (draftRead.data as { _isWorkingDraft?: boolean })._isWorkingDraft
    ).toBe(true);
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

  it("drops a field the schema removed from a reused draft's write and response", async () => {
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

    await entries.createEntry(ctx, { title: "live", status: "published" });
    const [row] = await handle!.adapter.select<LiveRow>(TABLE);
    const id = row.id;

    // The first status-less save writes `subtitle` into the working-draft snapshot.
    await entries.updateEntry(
      { ...ctx, entryId: id },
      { title: "draft-one", subtitle: "pending" }
    );
    await handle!.destroy();
    handle = undefined;

    // Reboot without `subtitle`; the sidecar JSON still carries it.
    const reopened = await bootFile({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [text({ name: "title" })],
        }),
      ],
    });

    // A second status-less save reuses the stale snapshot. The removed field must
    // not reach the response or the afterUpdate hooks, matching the read overlay.
    const res = await reopened.updateEntry(
      { ...ctx, entryId: id },
      { title: "draft-two" }
    );
    const data = res.data as Record<string, unknown>;
    expect(data.title).toBe("draft-two");
    expect("subtitle" in data).toBe(false);
  });

  it("clears a stale working draft when the status lifecycle is removed", async () => {
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

    // Store a working draft, then drop `status` from the schema (versioning stays
    // on). `collectionHasStatus` is now false, so the old status-scoped guard left
    // the sidecar behind; the next live write must drop it.
    await entries.updateEntry({ ...ctx, entryId: id }, { title: "pending" });
    expect(await workingDraftCount(id)).toBe(1);
    await handle!.destroy();
    handle = undefined;

    const reopened = await bootFile({
      collections: [
        defineCollection({
          slug: COLLECTION,
          versions: { drafts: true },
          fields: [text({ name: "title" })],
        }),
      ],
    });

    const res = await reopened.updateEntry(
      { ...ctx, entryId: id },
      { title: "edited" }
    );
    expect(res.success).toBe(true);
    expect(await workingDraftCount(id)).toBe(0);
  });

  it("clears a stale working draft after versioning is disabled", async () => {
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

    await entries.updateEntry({ ...ctx, entryId: id }, { title: "pending" });
    expect(await workingDraftCount(id)).toBe(1);
    await handle!.destroy();
    handle = undefined;

    // Reboot with versioning off (the status column stays). `versionsConfig` is
    // now null, so a gate keyed on it would leave the sidecar behind to resurface
    // if drafts were re-enabled; the next live write must drop it.
    const reopened = await bootFile({
      collections: [
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: false,
          fields: [text({ name: "title" })],
        }),
      ],
    });

    const res = await reopened.updateEntry(
      { ...ctx, entryId: id },
      { title: "edited" }
    );
    expect(res.success).toBe(true);
    expect(await workingDraftCount(id)).toBe(0);
  });

  it("shows the draft a publish would ship when an embedded component turns localized", async () => {
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

    // Re-open with the component now localized. This case previously asserted
    // that the read FELL BACK to the live row, on the premise that no write
    // could consume the sidecar any more. That premise stopped being true when a
    // localized component became representable in a draft snapshot: measured
    // here, the publish below succeeds, promotes the draft's content and clears
    // the sidecar. So the old behaviour meant an author was shown "live",
    // pressed Publish, and shipped content they had never seen.
    const reopened = await bootFile(withHero(true));

    const draftRead = await reopened.getEntry({
      collectionName: COLLECTION,
      entryId: id,
      overrideAccess: true,
      includeWorkingDraft: true,
    });
    expect((draftRead.data as { title?: string }).title).toBe("draft-title");

    // The invariant, asserted as the pair rather than as two separate facts:
    // what the editor is shown and what a publish would ship must be the same
    // document. Either alone can be right while the two disagree.
    const published = await reopened.updateEntry(
      { ...ctx, entryId: id },
      { status: "published" }
    );
    expect(published.success).toBe(true);
    const [afterPublish] = await handle!.adapter.select<LiveRow>(TABLE);
    expect({
      shown: (draftRead.data as { title?: string }).title,
      shipped: afterPublish?.title,
    }).toEqual({ shown: "draft-title", shipped: "draft-title" });
    expect(await workingDraftCount(id)).toBe(0);
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

// The admin editor fetches a collection's schema through the dispatcher path
// (CollectionsHandler.getCollection). It must carry `draftsEnabled` derived from
// the SAME eligibility the mutation service gates on, or the editor would present
// a status-less save as a pending draft while the server writes the live row.
describe("draft/published split — schema draftsEnabled flag (integration)", () => {
  async function draftsEnabledFor(
    collection: ReturnType<typeof defineCollection>
  ): Promise<boolean | undefined> {
    handle = await createTestNextly({ collections: [collection] });
    const res = await handle
      .getService("collectionsHandler")
      .getCollection({ collectionName: COLLECTION });
    return (res.data as { draftsEnabled?: boolean } | null)?.draftsEnabled;
  }

  it("is true for an eligible drafts collection", async () => {
    expect(
      await draftsEnabledFor(
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [text({ name: "title" }), text({ name: "body" })],
        })
      )
    ).toBe(true);
  });

  it("is false without the drafts lifecycle", async () => {
    expect(
      await draftsEnabledFor(
        defineCollection({
          slug: COLLECTION,
          status: true,
          fields: [text({ name: "title" })],
        })
      )
    ).toBe(false);
  });

  it("is true for a localized collection", async () => {
    // The editor is told drafts are on for a translated document, because they
    // are: a pending change is held per language, keyed by the language it
    // belongs to.
    expect(
      await draftsEnabledFor(
        defineCollection({
          slug: COLLECTION,
          status: true,
          localized: true,
          versions: { drafts: true },
          fields: [text({ name: "title" })],
        })
      )
    ).toBe(true);
  });

  it("is false for a collection with a reachable password field", async () => {
    expect(
      await draftsEnabledFor(
        defineCollection({
          slug: COLLECTION,
          status: true,
          versions: { drafts: true },
          fields: [text({ name: "title" }), password({ name: "secret" })],
        })
      )
    ).toBe(false);
  });
});
