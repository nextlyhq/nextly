/**
 * Resized copies of stored images, end to end: asked for at the media
 * routes and through the Direct API, served only to whoever may read the
 * item, made on request and never at upload, and removed with their original
 * whichever storage keeps them.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMediaHandlers } from "../../../api/media-handlers";
import { Nextly } from "../../../direct-api/nextly";
import { PUBLIC_ROLE_SLUG } from "../../auth/services/public-role";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { pdfDocument } from "../../../services/upload-validation/__tests__/format-fixtures";
import { Bucket } from "../../../storage/__tests__/stand-in-bucket";
import { getMediaStorage } from "../../../storage/storage";
import type { IStorageAdapter } from "../../../storage/types";
import { copyPathsOf, copyVersionOf } from "../copies/copy-rules";
import { MEDIA_USAGE_RECORDED_KEY } from "../usage/media-usage-store";

const ORIGIN = "http://localhost";
const WEBP = "image/webp,*/*;q=0.8";

/** A JPEG photo of `width` by `height`, in one colour. */
async function photo(width: number, height: number): Promise<Buffer> {
  return await sharp({
    create: { width, height, channels: 3, background: "#2a6f97" },
  })
    .jpeg()
    .toBuffer();
}

/** A GET of the media routes: the admin's gated mount, or the public one. */
function get(
  path: string[],
  options: { gated?: boolean; accept?: string; query?: string } = {}
): Promise<Response> {
  const base = options.gated === false ? "/api/media" : "/admin/api/media";
  return createMediaHandlers({ requireAuth: options.gated !== false }).GET(
    new Request(`${ORIGIN}${base}/${path.join("/")}${options.query ?? ""}`, {
      headers: {
        origin: ORIGIN,
        ...(options.accept ? { accept: options.accept } : {}),
      },
    }),
    { params: Promise.resolve({ path }) }
  );
}

/** The media collection's storage, read and written directly. */
function mediaStorage(): IStorageAdapter {
  return getMediaStorage().getAdapterForCollection("media");
}

/** Routes the media collection's files to `adapter`. */
function storeMediaIn(adapter: IStorageAdapter, type: string): void {
  getMediaStorage().registerPlugin({
    name: `copies-test-${type}`,
    type,
    collections: { media: true },
    adapter,
  });
}

describe.each(getConfiguredTestDialects())(
  "resized copies of stored images (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let publicId: string;

    /** Sets the Public role's permissions to exactly `slugs`. */
    async function setPublic(slugs: string[]): Promise<void> {
      const ids = (await t.nextly.permissions.find({ limit: 1000 })).items
        .filter(permission => slugs.includes(permission.slug))
        .map(permission => String(permission.id));
      await t.nextly.roles.setPermissions({
        roleId: publicId,
        permissionIds: ids,
      });
    }

    async function publicHolds(): Promise<string[]> {
      return (await t.nextly.roles.getPermissions({ id: publicId })).map(
        permission => permission.slug
      );
    }

    /** Uploads a 2200 by 1100 photo; its stored row. */
    async function uploadPhoto(name = "photo.jpg") {
      const data = await photo(2200, 1100);
      return await t.nextly.media.upload({
        file: { data, name, mimetype: "image/jpeg", size: data.length },
      });
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        seedPublic: true,
      });
      const publicRole = (await t.nextly.roles.find({ limit: 100 })).items.find(
        found => found.slug === PUBLIC_ROLE_SLUG
      );
      if (!publicRole) throw new Error("boot seeding made no Public role");
      publicId = String(publicRole.id);
      // A usage record already built, as a new site's is from the start, so
      // a replace removes the old files rather than keeping them for it.
      await t.getService("metaService").set(MEDIA_USAGE_RECORDED_KEY, {
        rebuiltAt: new Date().toISOString(),
      });
    });

    afterAll(async () => {
      await t?.destroy();
    });

    it("serves a copy at the nearest allowed width, keeps it, and serves the kept one again", async () => {
      const item = await uploadPhoto();
      const res = await get([item.id, "copy", "700"], { accept: WEBP });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(res.headers.get("vary")).toBe("Accept");
      const bytes = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(bytes).metadata();
      expect(meta.width).toBe(640);
      expect(meta.format).toBe("webp");
      expect(bytes.byteLength).toBeLessThan(item.size);
      const kept = `${item.filename}.w640.webp`;
      expect(await mediaStorage().exists(kept)).toBe(true);

      const again = await get([item.id, "copy", "640"], {
        accept: WEBP,
        query: `?v=${copyVersionOf(item.filename)}`,
      });
      expect(again.status).toBe(200);
      expect(Buffer.from(await again.arrayBuffer()).equals(bytes)).toBe(true);
      // The current version is cached for a year; the browser asked through
      // the gated mount, so only by itself.
      expect(again.headers.get("cache-control")).toBe(
        "private, max-age=31536000, immutable"
      );
    });

    it("is cached by shared caches on the public mount", async () => {
      const item = await uploadPhoto();
      const res = await get([item.id, "copy", "320"], {
        gated: false,
        query: `?v=${copyVersionOf(item.filename)}`,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/jpeg");
      expect(res.headers.get("cache-control")).toBe(
        "public, max-age=31536000, immutable"
      );
    });

    it("stores no copy at upload: each is made when first asked for", async () => {
      const item = await uploadPhoto();
      const copies = copyPathsOf(item);
      expect(copies.length).toBeGreaterThan(0);
      for (const copy of copies) {
        expect(await mediaStorage().exists(copy)).toBe(false);
      }
    });

    it("refuses a copy exactly as it refuses the item, and makes none", async () => {
      const item = await uploadPhoto();
      const held = await publicHolds();
      expect(held).toContain("read-media");

      // Readable: the item and its copy are both served to a visitor.
      expect((await get([item.id])).status).toBe(200);
      expect((await get([item.id, "copy", "160"])).status).toBe(200);

      await setPublic(held.filter(slug => slug !== "read-media"));
      try {
        const refusedItem = await get([item.id]);
        const refusedCopy = await get([item.id, "copy", "240"]);
        expect(refusedItem.status).toBe(401);
        expect(refusedCopy.status).toBe(refusedItem.status);
        expect(await mediaStorage().exists(`${item.filename}.w240.jpg`)).toBe(
          false
        );
        // A checked Direct API call naming nobody is refused the same way.
        await expect(
          new Nextly({ overrideAccess: false }).media.copyOf({
            id: item.id,
            width: 240,
          })
        ).rejects.toMatchObject({ statusCode: 401 });
      } finally {
        await setPublic(held);
      }
    });

    it("answers not found for a width that is not a number and for an item that does not exist", async () => {
      const item = await uploadPhoto();
      for (const width of ["abc", "640.webp", "-1", "0"]) {
        expect((await get([item.id, "copy", width])).status).toBe(404);
      }
      expect(
        (await get(["0b6f6c2e-3c3a-4b8e-9d2f-1f2e3d4c5b6a", "copy", "640"]))
          .status
      ).toBe(404);
    });

    it("gives the copy's address through the Direct API, and no copy where none can be had", async () => {
      const item = await uploadPhoto();
      expect(await t.nextly.media.copyOf({ id: item.id, width: 700 })).toEqual({
        url: `/api/media/${item.id}/copy/640?v=${copyVersionOf(item.filename)}`,
        width: 640,
      });
      expect(
        await t.nextly.media.copyOf({
          url: `/api/media/${item.id}/raw`,
          width: 1000,
        })
      ).toMatchObject({ width: 960 });
      // An image on another site has no copy: it is used as it is.
      expect(
        await t.nextly.media.copyOf({
          url: "https://images.example.com/photo.jpg",
          width: 640,
        })
      ).toBeNull();
      const pdf = pdfDocument("copies");
      const document = await t.nextly.media.upload({
        file: {
          data: pdf,
          name: "notes.pdf",
          mimetype: "application/pdf",
          size: pdf.length,
        },
      });
      expect(
        await t.nextly.media.copyOf({ id: document.id, width: 640 })
      ).toBeNull();
    });

    it("makes the old address stale when the file is replaced, and removes the old copies", async () => {
      const item = await uploadPhoto();
      const oldVersion = copyVersionOf(item.filename);
      expect((await get([item.id, "copy", "640"])).status).toBe(200);
      const oldCopy = `${item.filename}.w640.jpg`;
      expect(await mediaStorage().exists(oldCopy)).toBe(true);

      const square = await photo(1200, 1200);
      const replaced = await t.getService("mediaService").replaceFile(
        item.id,
        {
          buffer: square,
          filename: "square.jpg",
          mimeType: "image/jpeg",
          size: square.length,
        },
        {}
      );

      expect(replaced.filename).not.toBe(item.filename);
      expect(await mediaStorage().exists(oldCopy)).toBe(false);
      const stale = await get([item.id, "copy", "640"], {
        query: `?v=${oldVersion}`,
      });
      expect(stale.status).toBe(200);
      // Revalidated, and drawn from the new file.
      expect(stale.headers.get("cache-control")).toBe("private, no-cache");
      const meta = await sharp(Buffer.from(await stale.arrayBuffer())).metadata();
      expect(meta.height).toBe(640);
      const current = await t.nextly.media.copyOf({ id: item.id, width: 640 });
      expect(current?.url).toContain(`?v=${copyVersionOf(replaced.filename)}`);
      expect(current?.url).not.toContain(oldVersion);
    });

    describe.each([
      ["local disk", undefined],
      ["S3", "s3"],
      ["Vercel Blob", "vercel-blob"],
    ] as const)("kept on %s", (_label, scheme) => {
      it("is removed with its original", async () => {
        const local = mediaStorage();
        if (scheme) storeMediaIn(new Bucket(scheme), scheme);
        try {
          const item = await uploadPhoto();
          expect(
            (await get([item.id, "copy", "960"], { accept: "image/avif" }))
              .status
          ).toBe(200);
          const kept = `${item.filename}.w960.avif`;
          expect(await mediaStorage().exists(kept)).toBe(true);

          await t.nextly.media.delete({ id: item.id });

          expect(await mediaStorage().exists(item.filename)).toBe(false);
          expect(await mediaStorage().exists(kept)).toBe(false);
        } finally {
          if (scheme) storeMediaIn(local, "local");
        }
      });
    });

    it("serves the original from a storage that cannot keep copies", async () => {
      const local = mediaStorage();
      storeMediaIn(new Bucket("uploadthing"), "uploadthing");
      try {
        const item = await uploadPhoto();
        expect(
          await t.nextly.media.copyOf({ id: item.id, width: 640 })
        ).toBeNull();
        const res = await get([item.id, "copy", "640"]);
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe(item.url);
        expect(res.headers.get("cache-control")).toBe("no-store");
      } finally {
        storeMediaIn(local, "local");
      }
    });
  }
);
