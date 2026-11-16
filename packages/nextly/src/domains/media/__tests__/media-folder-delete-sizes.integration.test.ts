/**
 * A folder deleted with its contents, on a database from before image sizes
 * were removed, on every dialect: each item's size files go with it.
 *
 * The retired `sizes` column is the only record of an older item's size
 * files, and the Drizzle definition no longer names it. The delete reads it
 * inside its transaction, for the rows that transaction holds locked, so an
 * item that comes into the folder after the delete began is deleted with
 * its size files rather than leaving them stored with nothing naming them.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  retiredSizesColumnDdl,
  runOn,
  setRetiredSizes,
} from "../../../__tests__/helpers/retired-image-sizes";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { MediaFolderService } from "../../../services/media-folder";
import { PNG_1X1 } from "../../../services/upload-validation/__tests__/format-fixtures";
import { getMediaStorage } from "../../../storage/storage";
import { seedPlainAuthor } from "../../releases/__tests__/helpers/live-author";

describe.each(getConfiguredTestDialects())(
  "a folder deleted with its contents, items holding stored image sizes (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let author: string;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
      });
      // As an earlier release left the media table: its retired `sizes`
      // column, which names each older item's size files.
      await t.adapter.executeQuery(retiredSizesColumnDdl(dialect));
      author = await seedPlainAuthor(t);
    });

    afterAll(async () => {
      vi.restoreAllMocks();
      await t?.destroy();
    });

    const folders = () => new MediaFolderService(t.adapter, console as never);

    async function newFolder(): Promise<string> {
      const id = randomUUID();
      await t.adapter.insert("media_folders", {
        id,
        name: `folder-${id.slice(0, 6)}`,
        createdBy: author,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return id;
    }

    /** An item at the library's root, with one stored size, and its files. */
    async function olderItem(): Promise<{ id: string; files: string[] }> {
      const uploaded = await t.nextly.media.upload({
        file: {
          data: PNG_1X1,
          name: `older-${randomUUID().slice(0, 6)}.png`,
          mimetype: "image/png",
          size: PNG_1X1.length,
        },
      });
      const [row] = await t.adapter.select<{ filename: string }>("media", {
        where: { and: [{ column: "id", op: "=", value: uploaded.id }] },
      });
      const small = await getMediaStorage().upload(PNG_1X1, {
        filename: "older-small.png",
        mimeType: "image/png",
        collection: "media",
      });
      await runOn(
        t.adapter.getDrizzle(),
        dialect,
        setRetiredSizes(
          uploaded.id,
          JSON.stringify({ small: { path: small.path, url: small.url } })
        )
      );
      return { id: uploaded.id, files: [row.filename, small.path] };
    }

    /** Runs `first` as the delete's transaction is about to begin. */
    function asTransactionBegins(first: () => Promise<void>): void {
      const begin = t.adapter.transaction.bind(t.adapter);
      vi.spyOn(t.adapter, "transaction").mockImplementationOnce(
        async (...args: Parameters<typeof begin>) => {
          await first();
          return begin(...args);
        }
      );
    }

    async function stored(files: readonly string[]): Promise<boolean[]> {
      return Promise.all(
        files.map(file => getMediaStorage().exists(file, "media"))
      );
    }

    it("removes the size files of an item moved into the folder as its delete begins", async () => {
      const folder = await newFolder();
      const item = await olderItem();
      expect(await stored(item.files)).toEqual([true, true]);
      asTransactionBegins(async () => {
        await t.adapter.update(
          "media",
          { folderId: folder },
          { and: [{ column: "id", op: "=", value: item.id }] }
        );
      });

      const result = await folders().deleteFolder(folder, true);

      expect(result).toMatchObject({ success: true, deletedMedia: 1 });
      // The control: the item's original went the same way.
      expect(await stored(item.files)).toEqual([false, false]);
    });

    // Last, as it leaves the table without the column. A drop between the
    // delete's ask about the column and its transaction fails the read of
    // the sizes there, which on PostgreSQL would abort the transaction.
    it("finishes when the column is dropped as its transaction begins", async () => {
      const folder = await newFolder();
      const item = await olderItem();
      await t.adapter.update(
        "media",
        { folderId: folder },
        { and: [{ column: "id", op: "=", value: item.id }] }
      );
      await runOn(
        t.adapter.getDrizzle(),
        dialect,
        setRetiredSizes(item.id, null)
      );
      const q = dialect === "mysql" ? "`" : '"';
      asTransactionBegins(async () => {
        await t.adapter.executeQuery(
          `ALTER TABLE ${q}media${q} DROP COLUMN ${q}sizes${q}`
        );
      });

      const result = await folders().deleteFolder(folder, true);

      expect(result).toMatchObject({ success: true, deletedMedia: 1 });
      expect(await stored(item.files.slice(0, 1))).toEqual([false]);
    });
  }
);
