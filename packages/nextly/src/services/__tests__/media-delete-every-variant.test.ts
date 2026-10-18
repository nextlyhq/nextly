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
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestDb,
  testLogger,
  type TestDb,
} from "../../__tests__/fixtures/db";
import { storedFilesOf, variantPaths } from "../../domains/media/stored-files";
import type { IStorageAdapter, UploadOptions } from "../../storage/types";
import { runInPluginTransaction } from "../../shared/lib/plugin-transaction-scope";
import { MediaService } from "../media";
import { MediaFolderService } from "../media-folder";

// Two configured sizes, besides the thumbnail every image gets at upload, so
// a delete that removed only one would show. A case that needs more adds them
// to `extraSizes`, which is emptied after each.
const extraSizes = vi.hoisted(() => [] as Array<Record<string, unknown>>);
// A case that needs other sizes altogether sets `onlySizes`, also reset.
const onlySizes = vi.hoisted(() => ({
  configs: undefined as Array<Record<string, unknown>> | undefined,
}));
vi.mock("../image-size", () => ({
  ImageSizeService: class {
    async getActiveSizeConfigs() {
      if (onlySizes.configs) return onlySizes.configs;
      return [
        ...extraSizes,
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
  // What a crop reads its original through.
  async read(filePath: string) {
    return this.files.get(filePath) ?? null;
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
  extraSizes.length = 0;
  onlySizes.configs = undefined;
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
      // As a stored path is written, with `/` on every platform.
      path
        .relative(uploads, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    );
}

async function uploadPhoto(folderId?: string): Promise<string> {
  const file = await image();
  const result = await service.uploadMedia({
    file,
    filename: "photo.png",
    mimeType: "image/png",
    size: file.length,
    uploadedBy: "user-1",
    folderId,
  });
  expect(result.success).toBe(true);
  return result.data!.id;
}

const onLocalDisk = () =>
  initializeMediaStorage({
    local: { uploadDir: uploads, publicPath: "/uploads" },
  });

/** A promise and what settles it, to hold one request at a chosen point. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>(resolve => {
    open = resolve;
  });
  return { open, opened };
}

/** A crop, which regenerates the item's sizes under new keys. */
const crop = (id: string, focalX: number) =>
  service.updateMedia(id, { focalX, focalY: 50 });

/** The stored files of the item's current record. */
async function referencedNow(id: string): Promise<string[]> {
  const [row] = await db.db
    .select()
    .from(db.schema.media)
    .where(eq(db.schema.media.id, id));
  return row ? storedFilesOf(row).paths.sort() : [];
}

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
  // The first removal fails, with three files after it, so a delete that
  // stopped at the failure would leave them stored.
  it("is named, with its item, the rest still go, and the delete still succeeds", async () => {
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
    let failed: string | undefined;
    vi.spyOn(bucket, "delete").mockImplementation(async filePath => {
      if (failed === undefined) {
        failed = filePath;
        throw new Error("storage is unavailable");
      }
      bucket.files.delete(filePath);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await service.deleteMedia(id);

    expect(result.success).toBe(true);
    expect(failed).toBeDefined();
    expect([...bucket.files.keys()]).toEqual([failed]);
    const said = warn.mock.calls
      .map(args => args.map(String).join(" "))
      .join("\n");
    expect(said).toContain(failed);
    expect(said).toContain(id);
  });

  // A crop replaces the item's three sizes; the first removal fails, with two
  // after it, so a crop that stopped at the failure would leave them stored.
  it("is named when a crop cannot remove it, the rest still go, and the crop still succeeds", async () => {
    extraSizes.push({
      name: "large",
      width: 16,
      height: 16,
      fit: "cover",
      quality: 80,
      format: "webp",
    });
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
    const [row] = await db.db
      .select()
      .from(db.schema.media)
      .where(eq(db.schema.media.id, id));
    const replaced = variantPaths(row.sizes);
    expect(replaced).toHaveLength(3);
    let failed: string | undefined;
    vi.spyOn(bucket, "delete").mockImplementation(async filePath => {
      if (failed === undefined) {
        failed = filePath;
        throw new Error("storage is unavailable");
      }
      bucket.files.delete(filePath);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await crop(id, 20);

    expect(result.success).toBe(true);
    expect(replaced).toContain(failed);
    expect(replaced.filter(file => bucket.files.has(file))).toEqual([failed]);
    const said = warn.mock.calls
      .map(args => args.map(String).join(" "))
      .join("\n");
    expect(said).toContain(failed);
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

// A delete and a crop of the same item can run at once, and either may reach
// the database first. Either safe outcome passes: a crop that does not commit,
// or one whose variants the delete still removes. What may not happen is a
// file of the deleted item left stored. Each case checks the crop stored new
// variants, so that it cannot pass on a crop that did nothing.
describe("a delete and a crop of the same item at once", () => {
  it("leaves nothing when the crop commits before the delete reads the item's files", async () => {
    onLocalDisk();
    const id = await uploadPhoto();
    const before = await onDisk();
    const looked = gate();
    const cropped = gate();
    const firstLook = service.getMediaById.bind(service);
    // Hold the delete after its first look at the item, before its
    // transaction reads the files to remove.
    vi.spyOn(service, "getMediaById").mockImplementationOnce(async mediaId => {
      const found = await firstLook(mediaId);
      looked.open();
      await cropped.opened;
      return found;
    });

    const deleting = service.deleteMedia(id);
    await looked.opened;
    expect((await crop(id, 20)).success).toBe(true);
    const during = await onDisk();
    expect(during.filter(file => !before.includes(file))).toHaveLength(2);
    cropped.open();

    expect((await deleting).success).toBe(true);
    expect(await onDisk()).toEqual([]);
  });

  it("leaves nothing when the crop reaches its commit while the delete holds the item", async () => {
    onLocalDisk();
    const id = await uploadPhoto();
    const before = await onDisk();
    const read = gate();
    const queued = gate();
    let during: string[] = [];
    const transaction = db.adapter.transaction.bind(db.adapter);
    let calls = 0;
    // The delete's transaction is held after it has read the item and before
    // it removes the row, until the crop's transaction has been asked for.
    vi.spyOn(db.adapter, "transaction").mockImplementation(
      async (work, options) => {
        calls += 1;
        if (calls === 2) {
          during = await onDisk();
          queued.open();
          return transaction(work, options);
        }
        if (calls !== 1) return transaction(work, options);
        return transaction(async tx => {
          const removeRow = tx.delete.bind(tx);
          tx.delete = async (...args) => {
            read.open();
            await queued.opened;
            return removeRow(...args);
          };
          return work(tx);
        }, options);
      }
    );

    const deleting = service.deleteMedia(id);
    await read.opened;
    const cropping = crop(id, 20);
    const [deleted] = await Promise.all([deleting, cropping]);

    expect(during.filter(file => !before.includes(file))).toHaveLength(2);
    expect(deleted.success).toBe(true);
    expect(await onDisk()).toEqual([]);
  });
});

// An image stored while no sizes were configured has its upload-time
// thumbnail and no sizes. A crop once a `thumbnail` size is configured gives
// it one of those instead, and the upload-time thumbnail is then referred to
// by nothing.
describe("a crop of an item stored with no sizes", () => {
  it("removes the upload-time thumbnail a new thumbnail size replaces", async () => {
    onlySizes.configs = [];
    onLocalDisk();
    const id = await uploadPhoto();
    const before = await onDisk();
    expect(before).toHaveLength(2);
    onlySizes.configs = [
      {
        name: "thumbnail",
        width: 4,
        height: 4,
        fit: "cover",
        quality: 80,
        format: "webp",
      },
    ];

    expect((await crop(id, 20)).success).toBe(true);

    const stored = (await onDisk()).sort();
    expect(stored.filter(file => !before.includes(file))).toHaveLength(1);
    expect(stored).toEqual(await referencedNow(id));
    expect(stored).toHaveLength(2);
  });
});

// Two crops of one item that both read it before either commits each remove
// what their own commit replaced, read when they commit: the second replaces
// the first's variants, not the ones both read.
describe("two crops of the same item at once", () => {
  it("leave stored only what the record refers to", async () => {
    onLocalDisk();
    const id = await uploadPhoto();
    const before = await onDisk();
    const second = gate();
    const transaction = db.adapter.transaction.bind(db.adapter);
    let calls = 0;
    // The first crop's transaction waits for the second's to be asked for,
    // so both have read the item and stored their variants by then.
    vi.spyOn(db.adapter, "transaction").mockImplementation(
      async (work, options) => {
        calls += 1;
        if (calls === 1) await second.opened;
        if (calls === 2) second.open();
        return transaction(work, options);
      }
    );

    const results = await Promise.all([crop(id, 20), crop(id, 80)]);

    expect(results.every(result => result.success)).toBe(true);
    const stored = await onDisk();
    // Each crop stored two sizes of its own; only one pair is still used.
    expect(stored.filter(file => !before.includes(file))).toHaveLength(2);
    expect(stored.sort()).toEqual(await referencedNow(id));
  });
});

// Core code can delete or crop media inside a transaction of its own (a
// collection hook during an entry write). On SQLite the media write is then
// a savepoint of it, so the files stay until that transaction commits: if it
// rolls back, the row comes back and must still find its files.
describe("a delete or a crop inside an enclosing transaction", () => {
  it("leaves every file of a deleted item when that transaction rolls back", async () => {
    onLocalDisk();
    const id = await uploadPhoto();
    const before = await onDisk();

    await expect(
      db.adapter.transaction(async () => {
        expect((await service.deleteMedia(id)).success).toBe(true);
        throw new Error("the entry write failed");
      })
    ).rejects.toThrow("the entry write failed");

    expect(await onDisk()).toEqual(before);
    expect(await referencedNow(id)).toEqual([...before].sort());
  });

  it("removes them once that transaction commits", async () => {
    onLocalDisk();
    const id = await uploadPhoto();

    await db.adapter.transaction(async () => {
      expect((await service.deleteMedia(id)).success).toBe(true);
    });

    expect(await onDisk()).toEqual([]);
  });

  it("keeps the variants a crop replaced when that transaction rolls back", async () => {
    onLocalDisk();
    const id = await uploadPhoto();
    const before = await onDisk();

    await expect(
      db.adapter.transaction(async () => {
        expect((await crop(id, 20)).success).toBe(true);
        throw new Error("the entry write failed");
      })
    ).rejects.toThrow("the entry write failed");

    const stored = await onDisk();
    for (const file of before) expect(stored).toContain(file);
    expect(await referencedNow(id)).toEqual([...before].sort());
  });
});

// A plugin's `ctx.db.transaction` on SQLite is an enclosing transaction
// marked as the plugin's: the crop's write is a savepoint of it.
describe("a crop inside a plugin's transaction", () => {
  const inPluginTransaction = <T>(work: () => Promise<T>): Promise<T> =>
    db.adapter.transaction(() => runInPluginTransaction(work));

  it("removes the variants it replaced once that transaction commits", async () => {
    onLocalDisk();
    const id = await uploadPhoto();
    const before = await onDisk();

    await inPluginTransaction(async () => {
      expect((await crop(id, 20)).success).toBe(true);
    });

    const now = await referencedNow(id);
    expect(await onDisk()).toEqual(now);
    expect(now).not.toEqual([...before].sort());
  });

  it("keeps them when that transaction rolls back", async () => {
    onLocalDisk();
    const id = await uploadPhoto();
    const before = await onDisk();

    await expect(
      inPluginTransaction(async () => {
        expect((await crop(id, 20)).success).toBe(true);
        throw new Error("the plugin's write failed");
      })
    ).rejects.toThrow("the plugin's write failed");

    const stored = await onDisk();
    for (const file of before) expect(stored).toContain(file);
    expect(await referencedNow(id)).toEqual([...before].sort());
  });
});

describe("deleting a folder with its contents", () => {
  const folders = () => new MediaFolderService(db.adapter, testLogger);
  const newFolder = async (parentId?: string) => {
    const created = await folders().createFolder({
      name: `folder-${randomUUID()}`,
      parentId,
      createdBy: "user-1",
    });
    expect(created.success).toBe(true);
    return created.data!.id;
  };

  it("leaves nothing of its items, or of its subfolders' items, on local disk", async () => {
    onLocalDisk();
    const folder = await newFolder();
    const inner = await newFolder(folder);
    await uploadPhoto(folder);
    await uploadPhoto(inner);
    expect((await onDisk()).length).toBeGreaterThan(2);

    const result = await folders().deleteFolder(folder, true);

    expect(result.success).toBe(true);
    expect(result.deletedMedia).toBe(2);
    expect(await onDisk()).toEqual([]);
  });

  it("leaves every file stored when an enclosing transaction rolls back", async () => {
    onLocalDisk();
    const folder = await newFolder();
    const id = await uploadPhoto(folder);
    const before = await onDisk();

    await expect(
      db.adapter.transaction(async () => {
        expect((await folders().deleteFolder(folder, true)).success).toBe(true);
        throw new Error("the entry write failed");
      })
    ).rejects.toThrow("the entry write failed");

    expect(await onDisk()).toEqual(before);
    expect(await referencedNow(id)).toEqual([...before].sort());
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
