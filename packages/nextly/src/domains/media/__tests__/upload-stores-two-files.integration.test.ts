/**
 * An image upload stores the original and one fitted thumbnail, and nothing
 * else; a moved focus point stores nothing; and image sizes stored before they
 * were removed are left exactly as they were.
 *
 * Image sizes are no longer cut at upload, or again when the focus point
 * moves. A size defined at that time is still a row in `image_sizes`, which a
 * service that still cut sizes would find and act on, so every case starts
 * with one. What each adapter stored is read from the storage itself: a real
 * folder for local disk, and for S3, Vercel Blob and UploadThing a stand-in
 * that stores and names files exactly as those adapters do.
 *
 * Run against every dialect the process is configured for: the rows the
 * upload writes, the focus point it saves and the stored sizes it must leave
 * alone are each a column read back from the database.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { LocalStorageAdapter } from "../../../storage/adapters/local-adapter";
import { Bucket } from "../../../storage/__tests__/stand-in-bucket";
import { getMediaStorage } from "../../../storage/storage";
import type { IStorageAdapter } from "../../../storage/types";

/** A wide image, so a thumbnail cropped to a square would show. */
const wideImage = () =>
  sharp({
    create: { width: 1200, height: 300, channels: 3, background: "#47a" },
  })
    .png()
    .toBuffer();

/** Every file under a local uploads folder, by its path there. */
async function filesIn(folder: string): Promise<string[]> {
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter(entry => entry.isFile() && entry.name !== ".gitignore")
    .map(entry =>
      path
        .relative(folder, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    );
}

/** Routes the media collection's files to `adapter`. */
function storeMediaIn(
  adapter: IStorageAdapter,
  type: "local" | "s3" | "vercel-blob" | "uploadthing"
): void {
  getMediaStorage().registerPlugin({
    name: `upload-test-${type}`,
    type,
    collections: { media: true },
    adapter,
  });
}

/** The media row as stored, straight from the table. */
async function storedRow(
  t: TestNextly,
  id: string
): Promise<Record<string, unknown> | undefined> {
  const rows = (await t.adapter.select("media", {
    where: { and: [{ column: "id", op: "=", value: id }] },
  })) as Array<Record<string, unknown>>;
  return rows[0];
}

/** `sizes` as stored, read as an object whatever form the dialect returns. */
function sizesOf(row: Record<string, unknown> | undefined): unknown {
  const sizes = row?.sizes;
  return typeof sizes === "string"
    ? (JSON.parse(sizes) as unknown)
    : (sizes ?? null);
}

describe.each(getConfiguredTestDialects())(
  "an image's stored files (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let uploads: string;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
      });
      // A size defined before image sizes were removed, which a service that
      // still cut them would find.
      await t.adapter.insert("image_sizes", {
        id: "size-card",
        name: "card",
        width: 400,
        height: 300,
        fit: "cover",
        quality: 80,
        format: "webp",
        isDefault: true,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    afterAll(async () => {
      await t?.destroy();
    });

    afterEach(async () => {
      if (uploads) await rm(uploads, { recursive: true, force: true });
    });

    async function onLocalDisk(): Promise<void> {
      uploads = await mkdtemp(path.join(tmpdir(), "nextly-upload-files-"));
      storeMediaIn(
        new LocalStorageAdapter({ basePath: uploads, baseUrl: "/uploads" }),
        "local"
      );
    }

    async function upload(): Promise<{ id: string; item: object }> {
      const file = await wideImage();
      const item = await t.nextly.media.upload({
        file: {
          data: file,
          name: "wide.png",
          mimetype: "image/png",
          size: file.length,
        },
      });
      return { id: item.id, item };
    }

    it("stores the original and one fitted thumbnail on local disk, and no sizes", async () => {
      await onLocalDisk();

      const { id, item } = await upload();

      const stored = await filesIn(uploads);
      expect(stored).toHaveLength(2);
      const thumbnail = stored.find(file => file.includes("thumb_"));
      expect(thumbnail, "one of the two is the thumbnail").toBeDefined();
      // The whole wide image, fitted inside 480 by 480: not a square crop.
      const drawn = await sharp(
        await readFile(path.join(uploads, thumbnail!))
      ).metadata();
      expect([drawn.width, drawn.height]).toEqual([480, 120]);
      expect(sizesOf(await storedRow(t, id))).toBeNull();
      expect("sizes" in item).toBe(false);
    });

    it.each(["s3", "vercel-blob", "uploadthing"] as const)(
      "stores the original and one thumbnail on %s, and no sizes",
      async scheme => {
        const bucket = new Bucket(scheme);
        storeMediaIn(bucket, scheme);

        const { id } = await upload();

        expect(bucket.files.size).toBe(2);
        expect(sizesOf(await storedRow(t, id))).toBeNull();
      }
    );

    it("saves a moved focus point and stores no file", async () => {
      await onLocalDisk();
      const { id } = await upload();
      const before = (await filesIn(uploads)).sort();

      await t.nextly.media.update({ id, data: { focalX: 20, focalY: 70 } });

      expect((await filesIn(uploads)).sort()).toEqual(before);
      const row = await storedRow(t, id);
      expect([row?.focalX, row?.focalY]).toEqual([20, 70]);
      expect(sizesOf(row)).toBeNull();
    });

    it("leaves an earlier item's stored sizes, their files and the size definitions as they were", async () => {
      await onLocalDisk();
      const { id } = await upload();
      // The item as an upload before image sizes were removed left it: a
      // size file of its own, named in the row's `sizes`.
      const card = await getMediaStorage().upload(Buffer.from("card"), {
        filename: "wide-card.webp",
        mimeType: "image/webp",
        collection: "media",
      });
      const earlier = {
        card: { url: card.url, path: card.path, width: 400, height: 300 },
      };
      await t.adapter.update(
        "media",
        { sizes: JSON.stringify(earlier) },
        { and: [{ column: "id", op: "=", value: id }] }
      );
      const before = (await filesIn(uploads)).sort();
      expect(before).toContain(card.path);

      await t.nextly.media.update({ id, data: { focalX: 10, altText: "Sea" } });
      await upload();
      const read = await t.nextly.media.findByID({ id });

      expect(sizesOf(await storedRow(t, id))).toEqual(earlier);
      const after = await filesIn(uploads);
      for (const file of before) expect(after).toContain(file);
      // The upload in between added its own two files and nothing else.
      expect(after).toHaveLength(before.length + 2);
      const definitions = (await t.adapter.select(
        "image_sizes",
        {}
      )) as unknown[];
      expect(definitions).toHaveLength(1);
      // Stored, and still not offered.
      expect(read?.altText).toBe("Sea");
      expect("sizes" in (read as object)).toBe(false);
    });
  }
);
