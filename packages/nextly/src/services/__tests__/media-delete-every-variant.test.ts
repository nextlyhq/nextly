/**
 * Deleting a media item removes every file stored for it, on every adapter.
 *
 * An upload stores the original and a thumbnail. An item uploaded before image
 * sizes were removed also holds its sizes, each a file of its own named in the
 * row's `sizes`, and its delete still removes them. Each file is under a key
 * of its own: on local disk and S3 `YYYY/MM/<uuid>-<name>`,
 * on Vercel Blob a URL with a random suffix, which is also the blob's path,
 * and on UploadThing a random file key, served at `.../f/<key>`.
 * The record keeps the original's path and URL and each size's path, but
 * only the thumbnail's URL, so a delete that took the thumbnail's name from
 * the end of its URL removed a file that does not exist, and the thumbnail
 * stayed publicly served. Each case uploads through the real service with
 * real image processing, gives the item its stored sizes as such an earlier
 * upload stored them, deletes, and looks in the storage itself: a real
 * folder for local disk, and for S3, Vercel Blob and UploadThing a stand-in
 * that stores and names files exactly as those adapters do.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  getMediaStorage,
  initializeMediaStorage,
  resetMediaStorage,
} from "@nextly/storage";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTestDb,
  testLogger,
  type TestDb,
} from "../../__tests__/fixtures/db";
import { storedFilesOf } from "../../domains/media/stored-files";
import { Bucket } from "../../storage/__tests__/stand-in-bucket";
import { MediaService } from "../media";
import { MediaFolderService } from "../media-folder";

let db: TestDb;
let service: MediaService;
let uploads: string;

beforeEach(async () => {
  db = await createTestDb();
  // A database from before image sizes were removed: a new one has no
  // `sizes` column, so the column such a database still has is added back.
  db.sqlite.exec('ALTER TABLE "media" ADD COLUMN "sizes" TEXT');
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
      // As a stored path is written, with `/` on every platform.
      path
        .relative(uploads, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    );
}

/**
 * Gives an item two image sizes, as an upload made before sizes were removed
 * stored them: each a file of its own, through the item's storage, named in
 * the row's `sizes`. Two, so a delete that removed only one would show.
 */
async function withStoredSizes(id: string): Promise<void> {
  const sizes: Record<string, unknown> = {};
  for (const [name, side] of [
    ["small", 4],
    ["medium", 8],
  ] as const) {
    const buffer = await sharp(await image())
      .resize(side, side)
      .webp()
      .toBuffer();
    const filename = `photo-${name}.webp`;
    const stored = await getMediaStorage().upload(buffer, {
      filename,
      mimeType: "image/webp",
      collection: "media",
    });
    sizes[name] = {
      url: stored.url,
      path: stored.path,
      width: side,
      height: side,
      filesize: buffer.length,
      mimeType: "image/webp",
      filename,
    };
  }
  setStoredSizes(id, JSON.stringify(sizes));
}

/** Writes an item's retired `sizes`, which no Drizzle definition names. */
function setStoredSizes(id: string, sizes: string | null): void {
  db.sqlite
    .prepare('UPDATE "media" SET "sizes" = ? WHERE "id" = ?')
    .run(sizes, id);
}

/** An image uploaded, then given the sizes an earlier upload stored. */
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
  const id = result.data!.id;
  await withStoredSizes(id);
  return id;
}

const onLocalDisk = () =>
  initializeMediaStorage({
    local: { uploadDir: uploads, publicPath: "/uploads" },
  });

/** The stored files of the item's current record. */
async function referencedNow(id: string): Promise<string[]> {
  const [row] = await db.db
    .select()
    .from(db.schema.media)
    .where(eq(db.schema.media.id, id));
  return row
    ? storedFilesOf({ ...row, sizes: storedSizesOf(id) }).paths.sort()
    : [];
}

/** An item's retired `sizes`, read as the column holds it. */
function storedSizesOf(id: string): string | null {
  const row = db.sqlite
    .prepare('SELECT "sizes" FROM "media" WHERE "id" = ?')
    .get(id) as { sizes: string | null } | undefined;
  return row?.sizes ?? null;
}

/** A second item with the same stored files as `id`, as an import can make. */
async function copyOf(
  id: string,
  folderId: string | null = null
): Promise<string> {
  const [row] = await db.db
    .select()
    .from(db.schema.media)
    .where(eq(db.schema.media.id, id));
  const copy = `copy-of-${id}`;
  await db.db.insert(db.schema.media).values({ ...row, id: copy, folderId });
  setStoredSizes(copy, storedSizesOf(id));
  return copy;
}

describe("deleting a media item", () => {
  it("leaves nothing of it on local disk", async () => {
    onLocalDisk();
    const id = await uploadPhoto();
    const stored = await onDisk();
    // The original, its thumbnail and its two stored sizes, each in a date
    // folder: without the folders the case would not reach the defect.
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

// Nothing makes a stored path one item's alone: an import can copy a
// record, and a content-addressed adapter gives one file one key.
describe("a file another item also refers to", () => {
  it("stays when one of the items is deleted, and goes with the last", async () => {
    onLocalDisk();
    const id = await uploadPhoto();
    const copy = await copyOf(id);
    const before = await onDisk();

    expect((await service.deleteMedia(id)).success).toBe(true);
    expect(await onDisk()).toEqual(before);

    expect((await service.deleteMedia(copy)).success).toBe(true);
    expect(await onDisk()).toEqual([]);
  });

  // Two deletes of copies at once must not each see the other and both
  // keep the files: on PostgreSQL each transaction reads before the other
  // commits. Read once the delete has committed, the later read finds the
  // other row gone.
  it("is looked for only once the delete has committed", async () => {
    onLocalDisk();
    const id = await uploadPhoto();
    await copyOf(id);
    const transaction = db.adapter.transaction.bind(db.adapter);
    const getDrizzle = db.adapter.getDrizzle.bind(db.adapter);
    let committed = false;
    const lookedAfterCommit: boolean[] = [];
    vi.spyOn(db.adapter, "transaction").mockImplementation(
      async (work, options) => {
        const result = await transaction(work, options);
        committed = true;
        return result;
      }
    );
    // The search reads exactly the columns `storedFilesOf` needs.
    vi.spyOn(db.adapter, "getDrizzle").mockImplementation(relations => {
      const drizzle = getDrizzle(relations);
      return new Proxy(drizzle, {
        get(target, property, receiver) {
          if (property !== "select") {
            return Reflect.get(target, property, receiver) as unknown;
          }
          return (fields?: Record<string, unknown>) => {
            const read = Object.keys(fields ?? {})
              .sort()
              .join(",");
            if (read === "filename,sizes,thumbnailUrl,url") {
              lookedAfterCommit.push(committed);
            }
            return target.select(fields as never);
          };
        },
      });
    });

    expect((await service.deleteMedia(id)).success).toBe(true);

    expect(lookedAfterCommit).toEqual([true]);
  });

  /** Another item, with the stored files `fields` give it, and no folder. */
  async function anotherItem(fields: {
    filename: string;
    url: string;
    thumbnailUrl?: string | null;
    sizes?: string | null;
  }): Promise<void> {
    const { sizes, ...stored } = fields;
    const id = `other-${randomUUID()}`;
    await db.db.insert(db.schema.media).values({
      id,
      originalFilename: "other.png",
      mimeType: "image/png",
      size: 1,
      width: 1,
      height: 1,
      duration: null,
      thumbnailUrl: null,
      altText: null,
      caption: null,
      tags: null,
      uploadedBy: "user-1",
      uploadedAt: new Date(),
      updatedAt: new Date(),
      ...stored,
    });
    if (sizes !== undefined) setStoredSizes(id, sizes);
  }

  /** One of the item's sizes, by its stored path and URL. */
  async function aSizeOf(id: string): Promise<{ path: string; url: string }> {
    const row = db.sqlite
      .prepare('SELECT "sizes" FROM "media" WHERE "id" = ?')
      .get(id) as { sizes: string };
    const sizes = JSON.parse(row.sizes) as Record<
      string,
      { path: string; url: string }
    >;
    return Object.values(sizes)[0];
  }

  // Each shape another item can refer to a file by, alone: a control for
  // one says nothing of another.
  it.each([
    [
      "as its original",
      (size: { path: string; url: string }) => ({
        filename: size.path,
        url: size.url,
      }),
    ],
    [
      "only through one of its sizes",
      (size: { path: string; url: string }) => ({
        filename: "2026/10/elsewhere-x.png",
        url: "/uploads/2026/10/elsewhere-x.png",
        sizes: JSON.stringify({ small: size }),
      }),
    ],
    [
      "as its thumbnail, by the size's URL",
      (size: { path: string; url: string }) => ({
        filename: "2026/10/elsewhere-y.png",
        url: "/uploads/2026/10/elsewhere-y.png",
        thumbnailUrl: size.url,
      }),
    ],
    [
      "as its thumbnail, where its own original's spelling hides where that is",
      (size: { path: string; url: string }) => ({
        filename: "/2026//10/elsewhere-z.png",
        url: "/uploads/2026/10/elsewhere-z.png",
        thumbnailUrl: size.url,
      }),
    ],
    [
      "under another spelling of the same file",
      (size: { path: string; url: string }) => ({
        filename: `/${size.path.replace("/", "//")}`,
        url: size.url,
      }),
    ],
  ])("stays when another item refers to a size %s", async (_shape, refer) => {
    onLocalDisk();
    const id = await uploadPhoto();
    const size = await aSizeOf(id);
    await anotherItem(refer(size));

    expect((await service.deleteMedia(id)).success).toBe(true);

    const stored = await onDisk();
    expect(stored).toContain(size.path);
    expect(stored).toHaveLength(1);
  });

  // Nothing shows a file is unreferenced while the table cannot be read.
  it("keeps every file, and the delete still succeeds, when references cannot be read", async () => {
    onLocalDisk();
    const id = await uploadPhoto();
    const before = await onDisk();
    const getDrizzle = db.adapter.getDrizzle.bind(db.adapter);
    vi.spyOn(db.adapter, "getDrizzle").mockImplementation(relations => {
      const drizzle = getDrizzle(relations);
      return new Proxy(drizzle, {
        get(target, property, receiver) {
          if (property !== "select") {
            return Reflect.get(target, property, receiver) as unknown;
          }
          return (fields?: Record<string, unknown>) => {
            if ("sizes" in (fields ?? {}) && !("id" in (fields ?? {}))) {
              throw new Error("the connection was lost");
            }
            return target.select(fields as never);
          };
        },
      });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await service.deleteMedia(id)).success).toBe(true);

    expect(await onDisk()).toEqual(before);
    expect(
      warn.mock.calls.map(args => args.map(String).join(" ")).join("\n")
    ).toMatch(/could not check whether another item refers to them/);
  });

  it("stays when a folder holding one of the items is deleted", async () => {
    onLocalDisk();
    const folder = await new MediaFolderService(
      db.adapter,
      testLogger
    ).createFolder({
      name: "shared",
      createdBy: "user-1",
    });
    const id = await uploadPhoto(folder.data!.id);
    await copyOf(id);
    const before = await onDisk();

    const result = await new MediaFolderService(
      db.adapter,
      testLogger
    ).deleteFolder(folder.data!.id, true);

    expect(result.success).toBe(true);
    expect(await onDisk()).toEqual(before);
  });
});

describe("a file the delete cannot remove", () => {
  // What the storage says can carry a signed URL or a token.
  it("is named without the secrets in the storage's error", async () => {
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
    let calls = 0;
    vi.spyOn(bucket, "delete").mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        throw new Error(
          "refused https://key-id:key-secret@bucket.example/x.png?X-Amz-Signature=signed-secret"
        );
      }
      throw { token: "token-secret" };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await service.deleteMedia(id)).success).toBe(true);

    const said = warn.mock.calls
      .map(args =>
        args
          .map(arg => (typeof arg === "string" ? arg : JSON.stringify(arg)))
          .join(" ")
      )
      .join("\n");
    expect(said).toContain("https://bucket.example/x.png");
    expect(said).not.toMatch(/secret/);
  });

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
    // Fields arrive as an object beside the message, so they are read as
    // JSON rather than as `[object Object]`.
    const said = warn.mock.calls
      .map(args =>
        args
          .map(arg => (typeof arg === "string" ? arg : JSON.stringify(arg)))
          .join(" ")
      )
      .join("\n");
    expect(said).toContain(failed);
    expect(said).toContain(id);
  });

  // Nothing is guessed: a thumbnail whose location the record does not show
  // is left, and named by the one identifier there is, its URL.
  // Named without what can carry a secret: a signed URL's query, its
  // fragment, and any credentials before its host.
  it("is named by its URL when its location cannot be worked out, without its secrets", async () => {
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
    const located = "https://elsewhere.example/2026/10/b2-thumb_x.png";
    const thumbnailUrl =
      located.replace("https://", "https://key-id:key-secret@") +
      "?X-Amz-Signature=signed-secret#frag-secret";
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
    // Fields arrive as an object beside the message, so they are read as
    // JSON rather than as `[object Object]`.
    const said = warn.mock.calls
      .map(args =>
        args
          .map(arg => (typeof arg === "string" ? arg : JSON.stringify(arg)))
          .join(" ")
      )
      .join("\n");
    expect(said).toContain(located);
    expect(said).toContain("media-1");
    expect(said).not.toMatch(/secret/);
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

// Core code can delete media inside a transaction of its own (a collection
// hook during an entry write). On SQLite the delete is then a savepoint of it,
// so the files stay until that transaction commits: if it rolls back, the row
// comes back and must still find its files.
describe("a delete inside an enclosing transaction", () => {
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

  // An item can come into the folder after the delete's first reads and
  // before its transaction locks the folder. It is deleted with the rest, so
  // its retired sizes are read for the rows the transaction holds, not for
  // the ones the folder held when the delete began.
  it("removes the size files of an item moved into the folder as its delete begins", async () => {
    onLocalDisk();
    const folder = await newFolder();
    await uploadPhoto(folder);
    const moved = await uploadPhoto();
    const begin = db.adapter.transaction.bind(db.adapter);
    vi.spyOn(db.adapter, "transaction").mockImplementationOnce(
      async (...args: Parameters<typeof begin>) => {
        await db.db
          .update(db.schema.media)
          .set({ folderId: folder })
          .where(eq(db.schema.media.id, moved));
        return begin(...args);
      }
    );

    const result = await folders().deleteFolder(folder, true);

    expect(result.success).toBe(true);
    expect(result.deletedMedia).toBe(2);
    expect(await onDisk()).toEqual([]);
  });

  // A caller may still hand over storage with `bulkDelete`, as the cleanup
  // argument took before.
  it("hands a given storage every file of each item, once its rows are gone", async () => {
    onLocalDisk();
    const folder = await newFolder();
    const id = await uploadPhoto(folder);
    const files = await referencedNow(id);
    const given: string[][] = [];
    const storage = {
      bulkDelete: async (filePaths: string[]) => {
        given.push(filePaths);
        expect(await referencedNow(id)).toEqual([]);
        return { successful: filePaths, failed: [] };
      },
    };

    const result = await folders().deleteFolder(folder, true, storage);

    expect(result.success).toBe(true);
    expect(given.flat().sort()).toEqual(files);
  });

  // The rows are gone by the time their files are removed, so a cleanup
  // that fails must not stop the rest of the cascade.
  it("deletes the folder when a given cleanup fails", async () => {
    onLocalDisk();
    const folder = await newFolder();
    await uploadPhoto(folder);

    const result = await folders().deleteFolder(folder, true, async () => {
      throw new Error("storage is unavailable");
    });

    expect(result.success).toBe(true);
    expect((await folders().getFolderById(folder)).success).toBe(false);
  });

  it("names a failed cleanup without the secrets in its error", async () => {
    onLocalDisk();
    const folder = await newFolder();
    await uploadPhoto(folder);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await folders().deleteFolder(folder, true, async () => {
      throw new Error(
        "refused https://key-id:key-secret@bucket.example/x.png?X-Amz-Signature=signed-secret"
      );
    });

    expect(result.success).toBe(true);
    // Fields arrive as an object beside the message, so they are read as
    // JSON rather than as `[object Object]`.
    const said = warn.mock.calls
      .map(args =>
        args
          .map(arg => (typeof arg === "string" ? arg : JSON.stringify(arg)))
          .join(" ")
      )
      .join("\n");
    expect(said).toContain("https://bucket.example/x.png");
    expect(said).not.toMatch(/secret/);
  });

  // A folder of many items would otherwise ask the storage for every one of
  // their files at once.
  it("removes one item's files at a time", async () => {
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
    const folder = await newFolder();
    for (let i = 0; i < 3; i++) await uploadPhoto(folder);
    const perItem = bucket.files.size / 3;
    const remove = bucket.delete.bind(bucket);
    let inFlight = 0;
    let most = 0;
    vi.spyOn(bucket, "delete").mockImplementation(async filePath => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return remove(filePath);
    });

    expect((await folders().deleteFolder(folder, true)).success).toBe(true);

    expect(bucket.files.size).toBe(0);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(perItem);
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
