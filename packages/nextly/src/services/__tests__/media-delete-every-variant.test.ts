/**
 * Deleting a media item removes every file stored for it, on every adapter.
 *
 * An upload stores the original, a thumbnail and each configured image size,
 * each under a key of its own: on local disk and S3 `YYYY/MM/<uuid>-<name>`,
 * on Vercel Blob a URL with a random suffix, which is also the blob's path,
 * and on UploadThing a random file key, served at `.../f/<key>`.
 * The record keeps the original's path and URL and each size's path, but
 * only the thumbnail's URL, so a delete that took the thumbnail's name from
 * the end of its URL removed a file that does not exist, and the thumbnail
 * stayed publicly served. Each case uploads through the real service with
 * real image processing, deletes, and looks in the storage itself: a real
 * folder for local disk, and for S3, Vercel Blob and UploadThing a stand-in
 * that stores and names files exactly as those adapters do.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { initializeMediaStorage, resetMediaStorage } from "@nextly/storage";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestDb,
  testLogger,
  type TestDb,
} from "../../__tests__/fixtures/db";
import type { IStorageAdapter, UploadOptions } from "../../storage/types";
import { MediaService } from "../media";

// Two configured sizes, besides the thumbnail every image gets at upload, so
// a delete that removed only one would show.
vi.mock("../image-size", () => ({
  ImageSizeService: class {
    async getActiveSizeConfigs() {
      return [
        {
          name: "small",
          width: 4,
          height: 4,
          fit: "cover",
          quality: 80,
          format: "webp",
        },
        {
          name: "medium",
          width: 8,
          height: 8,
          fit: "cover",
          quality: 80,
          format: "webp",
        },
      ];
    }
  },
}));

/**
 * Stores files in memory, keyed and addressed as the S3, Vercel Blob or
 * UploadThing adapter keys and addresses them.
 */
class Bucket implements IStorageAdapter {
  readonly files = new Map<string, Buffer>();
  constructor(private readonly scheme: "s3" | "vercel-blob" | "uploadthing") {}

  async upload(buffer: Buffer, options: UploadOptions) {
    if (this.scheme === "s3") {
      const key = `2026/10/${randomUUID()}-${options.filename}`;
      this.files.set(key, buffer);
      return { url: this.getPublicUrl(key), path: key };
    }
    if (this.scheme === "uploadthing") {
      const key = randomUUID().replace(/-/g, "");
      this.files.set(key, buffer);
      return { url: this.getPublicUrl(key), path: key };
    }
    const dot = options.filename.lastIndexOf(".");
    const suffix = randomUUID().slice(0, 8);
    const url = `https://abc123.public.blob.vercel-storage.com/${options.filename.slice(0, dot)}-${suffix}${options.filename.slice(dot)}`;
    this.files.set(url, buffer);
    return { url, path: url };
  }
  async delete(filePath: string) {
    this.files.delete(filePath);
  }
  async exists(filePath: string) {
    return this.files.has(filePath);
  }
  getPublicUrl(filePath: string) {
    if (this.scheme === "s3") {
      return `https://bucket.s3.eu-west-1.amazonaws.com/${filePath}`;
    }
    if (this.scheme === "uploadthing") return `https://utfs.io/f/${filePath}`;
    return filePath;
  }
  getType() {
    return this.scheme;
  }
}

let db: TestDb;
let service: MediaService;
let uploads: string;

beforeEach(async () => {
  db = await createTestDb();
  await db.db.insert(db.schema.users).values({
    id: "user-1",
    email: "user@example.com",
    name: "User",
    passwordHash: "hash",
  });
  service = new MediaService(db.adapter, testLogger);
  uploads = await mkdtemp(path.join(tmpdir(), "nextly-media-delete-"));
});

afterEach(async () => {
  resetMediaStorage();
  vi.restoreAllMocks();
  await rm(uploads, { recursive: true, force: true });
});

const image = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: "#c33" } })
    .png()
    .toBuffer();

/** Every file under the local uploads folder, by its path there. */
async function onDisk(): Promise<string[]> {
  const entries = await readdir(uploads, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter(entry => entry.isFile() && entry.name !== ".gitignore")
    .map(entry =>
      path.relative(uploads, path.join(entry.parentPath, entry.name))
    );
}

async function uploadPhoto(): Promise<string> {
  const file = await image();
  const result = await service.uploadMedia({
    file,
    filename: "photo.png",
    mimeType: "image/png",
    size: file.length,
    uploadedBy: "user-1",
  });
  expect(result.success).toBe(true);
  return result.data!.id;
}

const onLocalDisk = () =>
  initializeMediaStorage({
    local: { uploadDir: uploads, publicPath: "/uploads" },
  });

describe("deleting a media item", () => {
  it("leaves nothing of it on local disk", async () => {
    onLocalDisk();
    const id = await uploadPhoto();
    const stored = await onDisk();
    // The original, its thumbnail and its two sizes, each in a date folder:
    // without the folders the case would not reach the defect.
    expect(stored).toHaveLength(4);
    expect(stored.every(file => /^\d{4}\/\d{2}\//.test(file))).toBe(true);
    expect(stored.some(file => file.includes("-thumb_"))).toBe(true);

    const result = await service.deleteMedia(id);

    expect(result.success).toBe(true);
    expect(await onDisk()).toEqual([]);
  });

  it.each(["s3", "vercel-blob", "uploadthing"] as const)(
    "leaves nothing of it on %s",
    async scheme => {
      const bucket = new Bucket(scheme);
      initializeMediaStorage({
        plugins: [
          {
            name: scheme,
            type: scheme,
            collections: { media: true },
            adapter: bucket,
          },
        ],
      });
      const id = await uploadPhoto();
      expect(bucket.files.size).toBe(4);

      const result = await service.deleteMedia(id);

      expect(result.success).toBe(true);
      expect([...bucket.files.keys()]).toEqual([]);
    }
  );

  // Bulk delete removes each item through the same steps; asserted on its
  // own all the same, since it is a separate way in.
  it("leaves nothing of the items deleted in bulk", async () => {
    onLocalDisk();
    const ids = [await uploadPhoto(), await uploadPhoto()];
    expect(await onDisk()).toHaveLength(8);

    await service.deleteMediaBulk(ids);

    expect(await onDisk()).toEqual([]);
  });
});

describe("a file the delete cannot remove", () => {
  it("is named, with its item, and the delete still succeeds", async () => {
    const bucket = new Bucket("s3");
    initializeMediaStorage({
      plugins: [
        {
          name: "s3",
          type: "s3",
          collections: { media: true },
          adapter: bucket,
        },
      ],
    });
    const id = await uploadPhoto();
    const thumb = [...bucket.files.keys()].find(key => key.includes("-thumb_"));
    vi.spyOn(bucket, "delete").mockImplementation(async filePath => {
      if (filePath === thumb) throw new Error("storage is unavailable");
      bucket.files.delete(filePath);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await service.deleteMedia(id);

    expect(result.success).toBe(true);
    const said = warn.mock.calls
      .map(args => args.map(String).join(" "))
      .join("\n");
    expect(said).toContain(thumb);
    expect(said).toContain(id);
  });

  // Nothing is guessed: a thumbnail whose location the record does not show
  // is left, and named by the one identifier there is, its URL.
  it("is named by its URL when its location cannot be worked out", async () => {
    const bucket = new Bucket("s3");
    initializeMediaStorage({
      plugins: [
        {
          name: "s3",
          type: "s3",
          collections: { media: true },
          adapter: bucket,
        },
      ],
    });
    const thumbnailUrl = "https://elsewhere.example/2026/10/b2-thumb_x.png";
    await db.db.insert(db.schema.media).values({
      id: "media-1",
      filename: "2026/10/a1-x.png",
      originalFilename: "x.png",
      mimeType: "image/png",
      size: 10,
      width: 1,
      height: 1,
      duration: null,
      url: "https://bucket.s3.eu-west-1.amazonaws.com/2026/10/a1-x.png",
      thumbnailUrl,
      altText: null,
      caption: null,
      tags: null,
      uploadedBy: "user-1",
      uploadedAt: new Date(),
      updatedAt: new Date(),
    });
    const removed = vi.spyOn(bucket, "delete");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await service.deleteMedia("media-1");

    expect(result.success).toBe(true);
    expect(removed.mock.calls.map(([p]) => p)).toEqual(["2026/10/a1-x.png"]);
    const said = warn.mock.calls
      .map(args => args.map(String).join(" "))
      .join("\n");
    expect(said).toContain(thumbnailUrl);
    expect(said).toContain("media-1");
  });
});

describe("a delete that does not commit", () => {
  it("leaves every file of the item stored", async () => {
    onLocalDisk();
    const id = await uploadPhoto();
    const before = await onDisk();
    vi.spyOn(db.adapter, "transaction").mockRejectedValueOnce(
      new Error("the database is unavailable")
    );

    const result = await service.deleteMedia(id);

    expect(result.success).toBe(false);
    expect(await onDisk()).toEqual(before);
  });
});

describe("a bulk delete that does not commit", () => {
  it("leaves every file of every item stored", async () => {
    onLocalDisk();
    const ids = [await uploadPhoto(), await uploadPhoto()];
    const before = await onDisk();
    vi.spyOn(db.adapter, "transaction").mockRejectedValue(
      new Error("the database is unavailable")
    );

    await service.deleteMediaBulk(ids);

    expect(await onDisk()).toEqual(before);
  });
});
