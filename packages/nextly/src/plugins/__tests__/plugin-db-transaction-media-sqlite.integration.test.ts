/**
 * Deleting media inside a plugin's transaction on SQLite is refused, through
 * the typed `ctx.db` and through `ctx.db.raw` alike.
 *
 * The media service's row delete joins the plugin's transaction as a
 * savepoint, but it removes the stored files once that savepoint releases. A
 * later rollback of the plugin's transaction then brings the row back pointing
 * at files that are gone, and nothing can restore them. So the delete is
 * refused before it touches the row or storage, and a delete outside any
 * transaction still goes through. Core's own transactions are not refused: a
 * collection hook deleting media while an entry write runs in one is a
 * documented cleanup, and core does not roll back after its hooks finish.
 *
 * The storage adapter's `delete` is replaced with a spy: a real one would
 * unlink files under `public/uploads/`, and what matters is whether the
 * service asked for the removal at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { type CollectionConfig, defineCollection, text } from "../../config";
import { NextlyError } from "../../errors/nextly-error";
import type { CollectionEntryService } from "../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../services/collections-handler";
import type { MediaService } from "../../services/media/media-service";
import { getMediaStorage } from "../../storage/storage";
import {
  definePlugin,
  type PluginContext,
  type PluginMediaService,
} from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

async function boot(
  collections: CollectionConfig[] = [],
  rawSql = false
): Promise<{ db: PluginContext["db"]; media: PluginMediaService }> {
  let captured:
    | { db: PluginContext["db"]; media: PluginMediaService }
    | undefined;
  const plugin = definePlugin({
    name: "@test/tx-media",
    version: "1.0.0",
    nextly: ">=0.0.0",
    capabilities: { db: { rawSql } },
    init(ctx) {
      captured = { db: ctx.db, media: ctx.services.media };
    },
  });
  current = await createTestNextly({
    plugins: [plugin],
    collections,
    pluginConsent: { rawSql: rawSql ? ["@test/tx-media"] : [] },
  });
  if (!captured) throw new Error("the plugin's init did not run");
  return captured;
}

/** A media row written straight to the table, never through the upload path. */
async function insertMedia(handle: TestNextly, id: string): Promise<void> {
  await handle.adapter.insert("media", {
    id,
    filename: `${id}.pdf`,
    originalFilename: `${id}.pdf`,
    mimeType: "application/pdf",
    size: 1,
    url: `/uploads/${id}.pdf`,
    uploadedAt: new Date(),
    updatedAt: new Date(),
  });
}

async function mediaRowExists(handle: TestNextly, id: string) {
  const rows = (await handle.adapter.select("media", {
    where: { and: [{ column: "id", op: "=", value: id }] },
  })) as unknown[];
  return rows.length === 1;
}

describe("deleting media inside ctx.db.transaction on sqlite", () => {
  it("is refused before the row or the stored file is touched", async () => {
    const { db, media } = await boot();
    const handle = current!;
    await insertMedia(handle, "kept-file");
    const removeFile = vi
      .spyOn(getMediaStorage(), "delete")
      .mockResolvedValue(undefined);

    const caught = await db
      .transaction(async () => {
        await media.delete("kept-file", {});
      })
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(NextlyError);
    expect((caught as NextlyError).code).toBe("CONFLICT");
    expect((caught as NextlyError).publicMessage).toMatch(
      /after the transaction, not inside it/
    );
    expect(removeFile).not.toHaveBeenCalled();
    expect(await mediaRowExists(handle, "kept-file")).toBe(true);
  });

  it.each([
    ["the restricted ctx.db.raw", false],
    ["a rawSql plugin's ctx.db.raw", true],
  ])("is refused inside a transaction of %s too", async (_, rawSql) => {
    const { db, media } = await boot([], rawSql);
    const handle = current!;
    await insertMedia(handle, "kept-raw");
    const removeFile = vi
      .spyOn(getMediaStorage(), "delete")
      .mockResolvedValue(undefined);

    const caught = await db.raw
      .transaction(async () => {
        await media.delete("kept-raw", {});
      })
      .catch((error: unknown) => error);

    expect((caught as NextlyError).code).toBe("CONFLICT");
    expect(removeFile).not.toHaveBeenCalled();
    expect(await mediaRowExists(handle, "kept-raw")).toBe(true);
  });

  it("refuses every item of a bulk delete the same way", async () => {
    const { db, media } = await boot();
    const handle = current!;
    await insertMedia(handle, "kept-a");
    await insertMedia(handle, "kept-b");
    const removeFile = vi
      .spyOn(getMediaStorage(), "delete")
      .mockResolvedValue(undefined);

    const result = await db.transaction(() =>
      media.bulkDelete(["kept-a", "kept-b"], {})
    );

    expect(result.successes).toEqual([]);
    expect(result.failures.map(failure => failure.code)).toEqual([
      "CONFLICT",
      "CONFLICT",
    ]);
    expect(removeFile).not.toHaveBeenCalled();
    expect(await mediaRowExists(handle, "kept-a")).toBe(true);
    expect(await mediaRowExists(handle, "kept-b")).toBe(true);
  });

  it("deletes the row and its file outside a transaction", async () => {
    // The control: a refusal of every delete would pass both cases above.
    const { media } = await boot();
    const handle = current!;
    await insertMedia(handle, "gone-file");
    const removeFile = vi
      .spyOn(getMediaStorage(), "delete")
      .mockResolvedValue(undefined);

    await media.delete("gone-file", {});

    expect(removeFile).toHaveBeenCalledWith("gone-file.pdf", "media");
    expect(await mediaRowExists(handle, "gone-file")).toBe(false);
  });
});

describe("deleting media inside core's own transaction on sqlite", () => {
  it("deletes the row and its file", async () => {
    const { media } = await boot();
    const handle = current!;
    await insertMedia(handle, "core-tx-file");
    const removeFile = vi
      .spyOn(getMediaStorage(), "delete")
      .mockResolvedValue(undefined);

    await handle.adapter.transaction(() => media.delete("core-tx-file", {}));

    expect(removeFile).toHaveBeenCalledWith("core-tx-file.pdf", "media");
    expect(await mediaRowExists(handle, "core-tx-file")).toBe(false);
  });

  it("deletes it from an afterDelete hook of an in-transaction entry delete", async () => {
    // A collection hook cleaning up the media an entry referenced, while the
    // entry delete runs inside core's transaction.
    let hookMedia: PluginMediaService | undefined;
    let hookError: unknown;
    const posts = defineCollection({
      slug: "posts",
      fields: [text({ name: "title" })],
      hooks: {
        afterDelete: [
          async () => {
            try {
              await hookMedia!.delete("cover-file", {});
            } catch (error) {
              hookError = error;
              throw error;
            }
          },
        ],
      },
    });
    const { media } = await boot([posts]);
    hookMedia = media;
    const handle = current!;
    await insertMedia(handle, "cover-file");
    const removeFile = vi
      .spyOn(getMediaStorage(), "delete")
      .mockResolvedValue(undefined);
    const entries = (
      handle.getService("collectionsHandler") as CollectionsHandler
    ).getEntryService() as CollectionEntryService;
    const created = await entries.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "with a cover" }
    );
    const entryId = (created.data as { id: string }).id;

    await handle.adapter.transaction(tx =>
      entries.deleteEntryInTransaction(tx as never, {
        collectionName: "posts",
        entryId,
      })
    );

    expect(hookError).toBeUndefined();
    expect(removeFile).toHaveBeenCalledWith("cover-file.pdf", "media");
    expect(await mediaRowExists(handle, "cover-file")).toBe(false);
  });
});
