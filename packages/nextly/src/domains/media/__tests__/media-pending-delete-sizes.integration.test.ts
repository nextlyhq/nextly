/**
 * A media delete that can be undone, finished once its window has passed, on
 * a database from before image sizes were removed, on every dialect: the
 * item's size files go with its row and its own files.
 *
 * A finished delete does not remove its files itself. Its finaliser records
 * them in the delete's transaction (`media.removing:<id>`) and removes them
 * from that record afterwards, so whatever the record leaves out stays in
 * storage with nothing naming it once the row is gone. The retired `sizes`
 * column is the only record of an older item's size files, and the Drizzle
 * definition no longer names it.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
import { PNG_1X1 } from "../../../services/upload-validation/__tests__/format-fixtures";
import { getMediaStorage } from "../../../storage/storage";
import {
  PENDING_DELETE_WINDOW_MS,
  PendingMediaDeletes,
  removingKey,
} from "../pending-delete";

describe.each(getConfiguredTestDialects())(
  "a finished delete of an item with stored image sizes (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
      });
      // As an earlier release left the media table: its retired `sizes`
      // column, which names each older item's size files.
      await t.adapter.executeQuery(retiredSizesColumnDdl(dialect));
    });

    afterAll(async () => {
      await t?.destroy();
    });

    /** The deletes as the routes build them, judged `laterBy` from now. */
    function deletes(laterBy = 0): PendingMediaDeletes {
      const media = t.getService("mediaService");
      return new PendingMediaDeletes({
        db: t.adapter,
        deleteItem: (id, actor, claim) => media.delete(id, {}, actor, claim),
        removeFiles: (id, files) => media.removeFilesOfDeleted(id, files),
        now: () => new Date(Date.now() + laterBy),
      });
    }

    async function rowOf(id: string) {
      const rows = await t.adapter.select<{ filename: string }>("media", {
        where: { and: [{ column: "id", op: "=", value: id }] },
      });
      return rows[0];
    }

    it("removes the item's size files with its own once the window has passed", async () => {
      const uploaded = await t.nextly.media.upload({
        file: {
          data: PNG_1X1,
          name: "older-photo.png",
          mimetype: "image/png",
          size: PNG_1X1.length,
        },
      });
      const original = (await rowOf(uploaded.id))?.filename;
      const small = await getMediaStorage().upload(PNG_1X1, {
        filename: "older-photo-small.png",
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
      expect(await getMediaStorage().exists(small.path, "media")).toBe(true);

      await deletes().mark([uploaded.id]);
      const finished = await deletes(
        PENDING_DELETE_WINDOW_MS + 1_000
      ).finalizeMarked([uploaded.id]);

      expect(finished).toEqual([uploaded.id]);
      expect(await rowOf(uploaded.id)).toBeUndefined();
      // The control: the item's own original went the same way.
      expect(await getMediaStorage().exists(String(original), "media")).toBe(
        false
      );
      expect(await getMediaStorage().exists(small.path, "media")).toBe(false);
      // And nothing is left recorded for a later attempt to remove.
      const left = await t.adapter.select("nextly_meta", {
        where: {
          and: [{ column: "key", op: "=", value: removingKey(uploaded.id) }],
        },
      });
      expect(left).toEqual([]);
    });

    // An import can copy a record whose size is recorded by its URL alone.
    // The finished delete reads the item that stays as it reads its own, so
    // the size file stays while that item names it.
    it("keeps a size file recorded by URL alone while another item names it, and removes it with the last", async () => {
      const upload = async (name: string) =>
        (
          await t.nextly.media.upload({
            file: {
              data: PNG_1X1,
              name,
              mimetype: "image/png",
              size: PNG_1X1.length,
            },
          })
        ).id;
      const first = await upload("shared-a.png");
      const second = await upload("shared-b.png");
      const small = await getMediaStorage().upload(PNG_1X1, {
        filename: "shared-small.png",
        mimeType: "image/png",
        collection: "media",
      });
      for (const id of [first, second]) {
        await runOn(
          t.adapter.getDrizzle(),
          dialect,
          setRetiredSizes(id, JSON.stringify({ small: { url: small.url } }))
        );
      }
      const finish = async (id: string) => {
        await deletes().mark([id]);
        return deletes(PENDING_DELETE_WINDOW_MS + 1_000).finalizeMarked([id]);
      };

      expect(await finish(first)).toEqual([first]);
      expect(await rowOf(first)).toBeUndefined();
      expect(await getMediaStorage().exists(small.path, "media")).toBe(true);

      expect(await finish(second)).toEqual([second]);
      expect(await getMediaStorage().exists(small.path, "media")).toBe(false);
    });
  }
);
