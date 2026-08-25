/**
 * A media write must bust the caches that could be serving that file.
 *
 * Media reads are not cached by core, so nothing here is invalidating media's
 * own cache. What goes stale is a PAGE that rendered the file — a cached read
 * tagged with `nextlyTags("media", id)` — and before this the write side emitted
 * nothing at all, so no tag a caller attached could ever be busted.
 *
 * Driven through the registered service rather than a hand-built one, so the DI
 * wiring is under test too: a service that flushes correctly but is constructed
 * without a revalidator invalidates nothing, and that is the failure this is
 * most likely to actually have.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import { getMediaStorage } from "../../../storage/storage";
import type { CacheRevalidator } from "../../../revalidation/types";
import { MediaFolderService } from "../../../services/media-folder";
import { MediaService as LegacyMediaService } from "../../../services/media";
import { MediaService as UnifiedMediaService } from "./../services/media-service";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  vi.restoreAllMocks();
});

/** The tags a write actually asked to invalidate. */
type FlushSpy = { mock: { calls: unknown[][] } };

function flushedTags(spy: FlushSpy): string[] {
  return spy.mock.calls.flatMap(call => {
    const intents = call[0] as { tags: string[] }[];
    return intents.flatMap(intent => intent.tags);
  });
}

async function bootWithSpy(): Promise<{
  handle: TestNextly;
  flush: ReturnType<typeof vi.spyOn> & FlushSpy;
}> {
  current = await createTestNextly({});
  // Resolved from the CONTAINER, not the typed service map: `cacheRevalidator`
  // is registered dynamically and is not a declared service key. This is the
  // same instance `revalidateMedia` resolves at flush time, so the spy sits on
  // the object actually used rather than on a copy of it.
  const revalidator = container.get<CacheRevalidator>("cacheRevalidator");
  return {
    handle: current,
    flush: vi.spyOn(revalidator, "flush"),
  };
}

describe("media writes bust their cache tags (integration)", () => {
  it("busts the file's tags on upload", async () => {
    const { handle, flush } = await bootWithSpy();

    const uploaded = await handle.nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "doc.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
    });

    // The control. Without it, an assertion about flushed tags is satisfied by
    // a write that never happened — and a failed upload flushes nothing for a
    // reason that has nothing to do with caching.
    expect(uploaded.id).toBeTruthy();

    const tags = flushedTags(flush);
    expect(tags).toContain("nextly:media");
    expect(tags).toContain(`nextly:media:id:${uploaded.id}`);
  });

  it("busts the file's tags on delete", async () => {
    const { handle, flush } = await bootWithSpy();

    const uploaded = await handle.nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "gone.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
    });
    expect(uploaded.id).toBeTruthy();
    flush.mockClear();

    await handle.nextly.media.delete({ id: uploaded.id });

    // Asserted after clearing, so this cannot be satisfied by the upload's own
    // flush — the two writes are separate events and a delete that busts
    // nothing leaves a removed file rendering from cache.
    const tags = flushedTags(flush);
    expect(tags).toContain(`nextly:media:id:${uploaded.id}`);
  });

  it("does not fail the write when the revalidator throws", async () => {
    const { handle, flush } = await bootWithSpy();
    flush.mockImplementation(() => {
      throw new Error("cache unreachable");
    });

    // The file is already committed by the time the flush runs. Turning a cache
    // failure into an upload failure would tell the caller their file was lost
    // while it sits in storage.
    const uploaded = await handle.nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "resilient.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
    });

    expect(uploaded.id).toBeTruthy();
    // The control: the throwing path was actually reached, so this is not
    // passing because the revalidator was never called.
    expect(flush).toHaveBeenCalled();
  });
});

describe("the write surfaces that do NOT go through the unified service", () => {
  it("invalidates when the LEGACY service is reached directly", async () => {
    // This is the published `nextly/actions` path. `uploadMediaAction` and its
    // siblings construct their own `ServiceContainer` and call the legacy
    // service — no DI, no unified wrapper. Invalidation placed on the wrapper
    // covers the admin and silently misses every action-driven write, so this
    // constructs the service the same way an action does.
    const { handle, flush } = await bootWithSpy();
    const legacy = new LegacyMediaService(handle.adapter, console as never);

    const result = await legacy.uploadMedia({
      file: Buffer.from("x"),
      filename: "via-action.pdf",
      mimeType: "application/pdf",
      size: 1,
      uploadedBy: null,
    });

    // The control: the upload actually happened. A failed write flushes nothing
    // for reasons that have nothing to do with caching.
    expect(result.success).toBe(true);
    const id = (result.data as { id: string }).id;

    expect(flushedTags(flush)).toContain(`nextly:media:id:${id}`);
  });

  it("invalidates every file removed by a cascading folder delete", async () => {
    // `deleteFolder(deleteContents: true)` removes media rows directly in the
    // folder service — it never reaches the media service, and the wrapper
    // discards the ids. Without this the deleted files keep being served from
    // cache after the row is gone.
    const { handle, flush } = await bootWithSpy();
    // A real user row: `createFolder` stores `context.user?.id` as `createdBy`,
    // which is a foreign key — an anonymous context fails the constraint rather
    // than exercising anything about caching.
    await handle.adapter.insert("users", {
      id: "curator-1",
      email: "curator-1@test.local",
    });
    const unified = handle.getService("mediaService") as UnifiedMediaService;
    const ctx = { user: { id: "curator-1" } } as Parameters<
      typeof unified.createFolder
    >[1];

    const folder = await unified.createFolder({ name: "doomed" }, ctx);
    const uploaded = await handle.nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "inside.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
      folder: folder.id,
    });

    // The fixture control, and it is not decoration: the Direct API takes
    // `folder`, not `folderId`, and an ignored key puts the file in the ROOT.
    // Nothing then cascades, the flush is empty, and the test reports a broken
    // implementation when the fixture was wrong. Asserted against the stored
    // row rather than the argument that was passed.
    expect(uploaded.id).toBeTruthy();
    expect(uploaded.folderId).toBe(folder.id);

    // A second file, so "one intent for N files" is a real claim rather than a
    // statement about a single-element list.
    const second = await handle.nextly.media.upload({
      file: {
        data: Buffer.from("y"),
        name: "also-inside.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
      folder: folder.id,
    });
    expect(second.folderId).toBe(folder.id);

    flush.mockClear();
    await unified.deleteFolder(folder.id, true, ctx);

    // Cleared first, so this cannot be satisfied by the uploads' own flushes.
    const tags = flushedTags(flush);
    expect(tags).toContain(`nextly:media:id:${uploaded.id}`);
    expect(tags).toContain(`nextly:media:id:${second.id}`);

    // ONE intent for both files, not one per file. Every file's tags carry the
    // same `nextly:media`, and the sink loops intents and tags without
    // deduplicating across them — so N files would re-invalidate the collection
    // tag N times, synchronously, before the delete returns.
    const intents = flush.mock.calls.flatMap(
      (call: unknown[]) => call[0] as unknown[]
    );
    expect(intents).toHaveLength(1);
    expect(tags.filter(t => t === "nextly:media")).toHaveLength(1);
  });

  it("invalidates a file moved between folders through the folder service", async () => {
    // Reachable through `ServiceContainer.mediaFolders`, the same public
    // surface the published actions use — and it writes the media row directly
    // rather than going through either media service, so it carries its own
    // invalidation.
    const { handle, flush } = await bootWithSpy();
    await handle.adapter.insert("users", {
      id: "mover-1",
      email: "mover-1@test.local",
    });
    const unified = handle.getService("mediaService") as UnifiedMediaService;
    const ctx = { user: { id: "mover-1" } } as Parameters<
      typeof unified.createFolder
    >[1];
    const folder = await unified.createFolder({ name: "target" }, ctx);

    const uploaded = await handle.nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "wanderer.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
    });
    // The control: it starts OUTSIDE the folder, so the move is a real change.
    expect(uploaded.folderId ?? null).toBeNull();

    flush.mockClear();
    const folders = new MediaFolderService(handle.adapter, console as never);
    const moved = await folders.moveMediaToFolder(uploaded.id, folder.id);

    expect(moved.success).toBe(true);
    expect(flushedTags(flush)).toContain(`nextly:media:id:${uploaded.id}`);
  });

  it("invalidates BEFORE the physical file cleanup, not after it", async () => {
    // Ordering, not presence. The row is gone the moment the transaction
    // commits, so a cached page is already wrong; deferring the bust past
    // storage deletes and their retry backoffs leaves it wrong for that whole
    // window, and a storage call that hangs until the request is killed would
    // leave it wrong permanently despite a committed delete.
    const { handle, flush } = await bootWithSpy();
    const uploaded = await handle.nextly.media.upload({
      file: {
        data: Buffer.from("x"),
        name: "ordered.pdf",
        mimetype: "application/pdf",
        size: 1,
      },
    });
    expect(uploaded.id).toBeTruthy();

    const storageDelete = vi.spyOn(getMediaStorage(), "delete");
    flush.mockClear();
    await handle.nextly.media.delete({ id: uploaded.id });

    // Two controls, because the comparison below is vacuous without both: the
    // cache must have been busted, AND the storage cleanup must have actually
    // run. If either never happened there is no ordering to check and the
    // assertion would pass on an empty pair.
    expect(flush).toHaveBeenCalled();
    expect(storageDelete).toHaveBeenCalled();

    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(
      storageDelete.mock.invocationCallOrder[0] as number
    );
  });
});

describe("a bulk fan-out flushes once, not once per file", () => {
  /** Upload `count` files and return their ids. */
  async function uploadFiles(
    handle: TestNextly,
    count: number
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const file = await handle.nextly.media.upload({
        file: {
          data: Buffer.from(`bulk-${i}`),
          name: `bulk-${i}.pdf`,
          mimetype: "application/pdf",
          size: 1,
        },
      });
      ids.push(file.id);
    }
    return ids;
  }

  it("busts every id in ONE intent through nextly.media.bulkDelete", async () => {
    const { handle, flush } = await bootWithSpy();
    const ids = await uploadFiles(handle, 3);

    flush.mockClear();
    const result = await handle.nextly.media.bulkDelete({ ids });

    // The fixture control, and it carries weight here: `bulkDelete` reports
    // per-id failures instead of throwing, so a run where every delete failed
    // returns normally and flushes nothing. Without this the "one intent"
    // assertion below is satisfied by a fan-out that deleted nothing at all.
    expect(result.successCount).toBe(3);
    expect(result.failedCount).toBe(0);

    // Presence first: each file's own tag must still be busted. Batching that
    // dropped ids would satisfy the count assertion perfectly.
    const tags = flushedTags(flush);
    for (const id of ids) {
      expect(tags).toContain(`nextly:media:id:${id}`);
    }

    // The claim. `bulkDelete` fans out over the single-item delete, which
    // invalidates against its own commit — so unbatched this is 3 intents and
    // 3 `revalidateTag("nextly:media")` calls for one operation.
    const intents = flush.mock.calls.flatMap(
      (call: unknown[]) => call[0] as unknown[]
    );
    expect(intents).toHaveLength(1);
    expect(tags.filter(t => t === "nextly:media")).toHaveLength(1);
  });

  it("still busts the ids that committed when one id in the batch fails", async () => {
    const { handle, flush } = await bootWithSpy();
    const ids = await uploadFiles(handle, 2);
    // A third id that was never uploaded: its delete fails while the other two
    // commit. Batching must not make a partial fan-out all-or-nothing — the two
    // committed rows are gone from the database whatever the third one did.
    //
    // This does NOT reach the scope's `finally`: the fan-out catches per-id
    // failures and returns them, so it settles normally. The throwing case is
    // covered directly in `revalidate-media.test.ts`.
    const withMissing = [...ids, "media-does-not-exist"];

    flush.mockClear();
    const result = await handle.nextly.media.bulkDelete({ ids: withMissing });

    // Both controls: the batch really was partial. Equal counts would mean
    // either nothing failed or nothing succeeded, and neither exercises this.
    expect(result.successCount).toBe(2);
    expect(result.failedCount).toBe(1);

    const tags = flushedTags(flush);
    for (const id of ids) {
      expect(tags).toContain(`nextly:media:id:${id}`);
    }
    expect(tags).not.toContain("nextly:media:id:media-does-not-exist");
  });

  it("keeps flushing per write when no batch is open", async () => {
    // The scope must not leak past the operation that opened it. Two separate
    // single deletes are two separate events for the caller, and collapsing
    // them would defer the first file's bust behind an unrelated later write.
    const { handle, flush } = await bootWithSpy();
    const ids = await uploadFiles(handle, 2);

    flush.mockClear();
    await handle.nextly.media.delete({ id: ids[0] as string });
    await handle.nextly.media.delete({ id: ids[1] as string });

    const intents = flush.mock.calls.flatMap(
      (call: unknown[]) => call[0] as unknown[]
    );
    expect(intents).toHaveLength(2);
  });
});
