/**
 * Removing the image size files items stored before sizes were removed, on
 * every storage the command runs against: real local disk, and stand-ins that
 * key and address files exactly as the S3 and Vercel Blob adapters do.
 *
 * The property that matters is what is NOT touched. Each case stores, in one
 * storage, an item's original, its upload thumbnail and its sizes, an item
 * whose thumbnail is one of its sizes, an item whose size names another item's
 * original, a document with no sizes, and files no media item names at all.
 * After the run the storage must hold exactly what it held before, less the
 * size files planned for removal, and the listing that precedes it must name
 * exactly those files.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalStorageAdapter } from "../../../storage/adapters/local-adapter";
import { Bucket } from "../../../storage/__tests__/stand-in-bucket";
import type { IStorageAdapter } from "../../../storage/types";
import { storedKeysOn, type ReferencedNow } from "../orphan-thumbnails";
import {
  holdsStoredSizes,
  removeStoredImageSizes,
  type MediaSizesRow,
  type RetiredSizesStore,
} from "../retired-image-sizes";
import { storedFilesOf } from "../stored-files";

/** An in-memory media table: the rows, and which items had their sizes cleared. */
class MemoryStore implements RetiredSizesStore {
  readonly cleared: string[] = [];
  constructor(readonly table: MediaSizesRow[]) {}
  async *rows() {
    // Two rows a page, so paging is exercised.
    for (let i = 0; i < this.table.length; i += 2) {
      yield this.table.slice(i, i + 2).map(row => ({ ...row }));
    }
  }
  async clearSizes(id: string) {
    this.cleared.push(id);
    const row = this.table.find(entry => entry.id === id);
    if (row) row.sizes = null;
  }
}

/**
 * What the in-memory table's items use now as originals and thumbnails, read
 * from its rows when asked, through `storedFilesOf` as the database check
 * reads each row, without the retired sizes, and compared as `storage` tells
 * its files apart (local disk unless given). The check itself, over a real
 * media table, is the CLI's (`referencedNowIn`), covered beside the command.
 */
function usedIn(
  store: MemoryStore,
  storage: Pick<IStorageAdapter, "getType"> = { getType: () => "local" }
): ReferencedNow {
  const keys = storedKeysOn(storage.getType());
  return async paths => {
    const used = new Set(
      store.table.flatMap(row =>
        storedFilesOf({ ...row, sizes: undefined }).paths.map(keys.path)
      )
    );
    return new Set(paths.filter(path => used.has(keys.path(path))));
  };
}

interface Storage {
  adapter: IStorageAdapter;
  /** Every file the storage holds, by stored path. */
  files(): Promise<string[]>;
  /** Removes what the storage left on disk, where it left anything. */
  dispose?: () => Promise<void>;
}

/** Local disk in a folder of the test's own, read back by listing it. */
async function localDisk(): Promise<Storage & { dispose(): Promise<void> }> {
  const folder = await mkdtemp(path.join(tmpdir(), "nextly-remove-sizes-"));
  const adapter = new LocalStorageAdapter({
    basePath: folder,
    baseUrl: "/uploads",
  });
  return {
    adapter,
    files: async () => {
      const listed: string[] = [];
      for await (const entry of adapter.list()) listed.push(entry.path);
      return listed.sort();
    },
    dispose: () => rm(folder, { recursive: true, force: true }),
  };
}

function bucket(scheme: "s3" | "vercel-blob"): Storage {
  const adapter = new Bucket(scheme);
  return { adapter, files: async () => [...adapter.files.keys()].sort() };
}

const STORAGES: ReadonlyArray<readonly [string, () => Promise<Storage>]> = [
  ["local disk", localDisk],
  ["S3", async () => bucket("s3")],
  ["Vercel Blob", async () => bucket("vercel-blob")],
];

async function put(storage: IStorageAdapter, filename: string) {
  return storage.upload(Buffer.from(filename), {
    filename,
    mimeType: "image/webp",
    collection: "media",
  });
}

/** A size as an upload before the removal stored it. */
async function storedSize(storage: IStorageAdapter, filename: string) {
  const stored = await put(storage, filename);
  return { url: stored.url, path: stored.path, width: 8, height: 8, filename };
}

/**
 * The library described in the header, stored in `storage`. Returns the rows
 * and, by role, the files the removal must remove and must keep.
 */
async function library(storage: IStorageAdapter) {
  // An image with its own upload thumbnail and two sizes.
  const photo = await put(storage, "photo.png");
  const photoThumb = await put(storage, "photo-thumb.webp");
  const photoSmall = await storedSize(storage, "photo-small.webp");
  const photoMedium = await storedSize(storage, "photo-medium.webp");

  // An image whose thumbnail is its `thumbnail` size, with a `large` size and
  // a `medium` size whose file is already gone from storage.
  const wide = await put(storage, "wide.png");
  const wideThumbnail = await storedSize(storage, "wide-thumbnail.webp");
  const wideLarge = await storedSize(storage, "wide-large.webp");
  const wideMedium = await storedSize(storage, "wide-medium.webp");
  await storage.delete(wideMedium.path);

  // An item copied by an import: its `small` size names the photo's original.
  const copy = await put(storage, "copy.png");
  const copyOwnSmall = await storedSize(storage, "copy-small.webp");

  // A document, with no sizes, and an image whose sizes are an empty object.
  const doc = await put(storage, "manual.pdf");
  const empty = await put(storage, "empty.png");

  // Files no media item names, in the same storage.
  await put(storage, "site-logo.png");
  await put(storage, "notes.txt");

  const rows: MediaSizesRow[] = [
    {
      id: "a-photo",
      filename: photo.path,
      url: photo.url,
      thumbnailUrl: photoThumb.url,
      sizes: JSON.stringify({ small: photoSmall, medium: photoMedium }),
    },
    {
      id: "b-wide",
      filename: wide.path,
      url: wide.url,
      thumbnailUrl: wideThumbnail.url,
      // As PostgreSQL and MySQL return it: an object.
      sizes: {
        thumbnail: wideThumbnail,
        large: wideLarge,
        medium: wideMedium,
      },
    },
    {
      id: "c-copy",
      filename: copy.path,
      url: copy.url,
      thumbnailUrl: null,
      sizes: JSON.stringify({
        small: { url: photo.url, path: photo.path },
        own: copyOwnSmall,
      }),
    },
    {
      id: "d-doc",
      filename: doc.path,
      url: doc.url,
      thumbnailUrl: null,
      sizes: null,
    },
    {
      id: "e-empty",
      filename: empty.path,
      url: empty.url,
      thumbnailUrl: null,
      sizes: "{}",
    },
  ];
  return {
    rows,
    removed: [
      photoSmall.path,
      photoMedium.path,
      wideLarge.path,
      // Already gone; the run still counts it as removed.
      wideMedium.path,
      copyOwnSmall.path,
    ],
    paths: {
      photoSmall: photoSmall.path,
      photoMedium: photoMedium.path,
      wideThumbnail: wideThumbnail.path,
      wideLarge: wideLarge.path,
      wideMedium: wideMedium.path,
      photo: photo.path,
      copyOwnSmall: copyOwnSmall.path,
      copy: copy.path,
      wide: wide.path,
    },
  };
}

const objects = { column: true, tableRows: 3, keptTable: null };

/** A storage that refuses to delete one path, with a secret in its error. */
function refusing(adapter: IStorageAdapter, refused: string): IStorageAdapter {
  return Object.assign(Object.create(adapter) as IStorageAdapter, {
    delete: async (filePath: string) => {
      if (filePath === refused) {
        throw new Error(
          `AccessDenied for https://bucket.example/${refused}?X-Amz-Signature=sekrit-signature`
        );
      }
      await adapter.delete(filePath);
    },
  });
}

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (disposals.length > 0) await disposals.pop()?.();
});

describe.each(STORAGES)(
  "nextly media remove-sizes on %s",
  (_name, makeStorage) => {
    async function setUp() {
      const storage = await makeStorage();
      if (storage.dispose) disposals.push(storage.dispose);
      const fixture = await library(storage.adapter);
      return { storage, fixture, store: new MemoryStore(fixture.rows) };
    }

    it("lists exactly the size files it would remove and keep, and changes nothing", async () => {
      const { storage, fixture, store } = await setUp();
      const before = await storage.files();
      const lines: string[] = [];

      const { code } = await removeStoredImageSizes({
        store,
        storage: storage.adapter,
        objects,
        apply: false,
        referencedNow: usedIn(store),
        say: line => lines.push(line),
      });

      const { paths } = fixture;
      expect(code).toBe(0);
      expect(lines).toEqual([
        "Dry run: nothing is changed.",
        `media a-photo (${paths.photo})`,
        `  remove ${paths.photoSmall} (size "small")`,
        `  remove ${paths.photoMedium} (size "medium")`,
        "  clear  its stored sizes",
        `media b-wide (${paths.wide})`,
        `  remove ${paths.wideLarge} (size "large")`,
        `  remove ${paths.wideMedium} (size "medium")`,
        `  keep   ${paths.wideThumbnail} (size "thumbnail": the item's thumbnail)`,
        "  clear  its stored sizes",
        `media c-copy (${paths.copy})`,
        `  remove ${paths.copyOwnSmall} (size "own")`,
        `  keep   ${paths.photo} (size "small": a media item uses it as an original or a thumbnail)`,
        "  clear  its stored sizes",
        "Would remove 5 files from storage, keep 2, and clear the stored sizes of 3 of 3 items.",
        "Once no item holds sizes, `nextly media remove-sizes --apply --drop` drops the `sizes` column of the `media` table and the `image_sizes` table (3 rows, the size definitions).",
        "Back up the database and the media storage first, then run again with --apply.",
      ]);
      expect(await storage.files()).toEqual(before);
      expect(store.cleared).toEqual([]);
    });

    it("removes only the size files, and every other file survives", async () => {
      const { storage, fixture, store } = await setUp();
      const before = await storage.files();

      const { code, report } = await removeStoredImageSizes({
        store,
        storage: storage.adapter,
        objects,
        apply: true,
        referencedNow: usedIn(store),
        say: () => {},
      });

      expect(code).toBe(0);
      // Exactly what was there, less the size files planned for removal: the
      // originals, the upload thumbnail, the thumbnail that is a size, the
      // shared original and the files no item names all remain.
      const removed = new Set(fixture.removed);
      expect(await storage.files()).toEqual(
        before.filter(file => !removed.has(file))
      );
      expect(await storage.files()).toEqual(
        expect.arrayContaining([
          fixture.paths.photo,
          fixture.paths.wideThumbnail,
          fixture.paths.copy,
        ])
      );
      expect(store.cleared).toEqual(["a-photo", "b-wide", "c-copy"]);
      expect(fixture.rows.map(row => holdsStoredSizes(row.sizes))).toEqual([
        false,
        false,
        false,
        false,
        false,
      ]);
      // The document's and the empty item's values were never written.
      expect(fixture.rows[4].sizes).toBe("{}");
      expect(report).toMatchObject({
        itemsCleared: 3,
        filesRemoved: 5,
        filesKept: 2,
        itemsLeft: [],
      });
    });

    it("changes nothing when run again", async () => {
      const { storage, store } = await setUp();
      await removeStoredImageSizes({
        store,
        storage: storage.adapter,
        objects,
        apply: true,
        referencedNow: usedIn(store),
        say: () => {},
      });
      const after = await storage.files();
      const lines: string[] = [];

      const { code } = await removeStoredImageSizes({
        store,
        storage: storage.adapter,
        objects,
        apply: true,
        referencedNow: usedIn(store),
        say: line => lines.push(line),
      });

      expect(code).toBe(0);
      expect(await storage.files()).toEqual(after);
      expect(store.cleared).toEqual(["a-photo", "b-wide", "c-copy"]);
      expect(lines[0]).toBe(
        "No media item holds image sizes: there are no size files to remove."
      );
    });

    it("keeps an item's sizes when a file is refused, names it without the secret, and goes on", async () => {
      const { storage, fixture, store } = await setUp();
      const lines: string[] = [];

      const { code, report } = await removeStoredImageSizes({
        store,
        storage: refusing(storage.adapter, fixture.paths.photoMedium),
        objects,
        apply: true,
        referencedNow: usedIn(store),
        say: line => lines.push(line),
      });

      expect(code).toBe(1);
      // The refused item is left whole, the others are finished.
      expect(store.cleared).toEqual(["b-wide", "c-copy"]);
      expect(holdsStoredSizes(fixture.rows[0].sizes)).toBe(true);
      expect(report.itemsLeft.map(item => item.id)).toEqual(["a-photo"]);
      const output = lines.join("\n");
      expect(output).toContain(
        `could not remove ${fixture.paths.photoMedium}: AccessDenied`
      );
      expect(output).toContain("a-photo");
      expect(output).not.toContain("sekrit");
      expect(output).not.toContain("X-Amz-Signature");

      // Once the storage allows it, a run finishes the item.
      const { code: second } = await removeStoredImageSizes({
        store,
        storage: storage.adapter,
        objects,
        apply: true,
        referencedNow: usedIn(store),
        say: () => {},
      });
      expect(second).toBe(0);
      expect(store.cleared).toEqual(["b-wide", "c-copy", "a-photo"]);
      expect(await storage.files()).not.toContain(fixture.paths.photoMedium);
    });
  }
);

describe("an item whose sizes cannot be read", () => {
  it("is left as it is, with nothing of it removed", async () => {
    const storage = bucket("s3");
    const original = await put(storage.adapter, "odd.png");
    const store = new MemoryStore([
      {
        id: "odd",
        filename: original.path,
        url: original.url,
        thumbnailUrl: null,
        sizes: "{not json",
      },
    ]);
    const before = await storage.files();
    const lines: string[] = [];

    const { code } = await removeStoredImageSizes({
      store,
      storage: storage.adapter,
      objects: { column: true, tableRows: null, keptTable: null },
      apply: true,
      referencedNow: usedIn(store),
      say: line => lines.push(line),
    });

    expect(code).toBe(1);
    expect(store.cleared).toEqual([]);
    expect(await storage.files()).toEqual(before);
    expect(lines.join("\n")).toContain("its stored sizes cannot be read");
  });
});

/** One item holding two sizes, stored in `storage`. */
async function oneItem(storage: IStorageAdapter) {
  const original = await put(storage, "photo.png");
  const small = await storedSize(storage, "photo-small.webp");
  const large = await storedSize(storage, "photo-large.webp");
  const store = new MemoryStore([
    {
      id: "item",
      filename: original.path,
      url: original.url,
      thumbnailUrl: null,
      sizes: JSON.stringify({ small, large }),
    },
  ]);
  return { original, small, large, store };
}

describe("a size entry that is not a size record it can read", () => {
  // Each of these may name a file, as the first does, or say nothing of one,
  // and nothing tells which: clearing the item's sizes over it could leave a
  // file stored with nothing pointing at it.
  it.each([
    ["a bare path", "/uploads/2026/10/photo-small.webp"],
    ["a number", 42],
    ["null", null],
    ["a list", ["2026/10/photo-small.webp"]],
    ["an object naming no file", { width: 8, height: 8 }],
    ["a path that is not text", { path: 42 }],
    ["an empty path", { path: "" }],
  ])(
    "leaves the item as it is, named, and exits non-zero, for %s",
    async (_case, entry) => {
      const storage = bucket("s3");
      const original = await put(storage.adapter, "photo.png");
      const large = await storedSize(storage.adapter, "photo-large.webp");
      const store = new MemoryStore([
        {
          id: "odd",
          filename: original.path,
          url: original.url,
          thumbnailUrl: null,
          sizes: JSON.stringify({ small: entry, large }),
        },
      ]);
      const before = await storage.files();
      const lines: string[] = [];

      const { code, report } = await removeStoredImageSizes({
        store,
        storage: storage.adapter,
        objects,
        apply: true,
        referencedNow: usedIn(store),
        say: line => lines.push(line),
      });

      expect(code).toBe(1);
      expect(store.cleared).toEqual([]);
      expect(holdsStoredSizes(store.table[0].sizes)).toBe(true);
      // Nothing of the item is removed, the readable size included.
      expect(await storage.files()).toEqual(before);
      expect(report.itemsLeft.map(item => item.id)).toEqual(["odd"]);
      expect(lines.join("\n")).toContain("odd");
    }
  );
});

describe("a size recorded by its path alone", () => {
  // Nothing in such a record says which storage the file is on, and the item
  // cannot say either: a Replace stores the new original on the storage
  // configured then and keeps the item's sizes. A path taken for this
  // storage's would delete this storage's own file of that name, and the
  // record cleared would leave the real one stored with nothing naming it.
  it("is left, named, and nothing deleted, once the item's original was replaced onto another storage", async () => {
    const adapter = new Bucket("s3");
    // The original as a Replace left it, on this bucket. The size was stored
    // beside the earlier original, elsewhere, and this bucket holds a file of
    // its own at the very key the size names.
    const original = await put(adapter, "photo.png");
    const key = "2026/10/photo-small.webp";
    adapter.files.set(key, Buffer.from("this bucket's own file"));
    const store = new MemoryStore([
      {
        id: "replaced",
        filename: original.path,
        url: original.url,
        thumbnailUrl: null,
        sizes: JSON.stringify({ small: { path: key } }),
      },
    ]);
    const before = [...adapter.files.keys()].sort();
    const listed: string[] = [];
    const applied: string[] = [];

    const dry = await removeStoredImageSizes({
      store,
      storage: adapter,
      objects,
      apply: false,
      referencedNow: usedIn(store),
      say: line => listed.push(line),
    });
    const { code, report } = await removeStoredImageSizes({
      store,
      storage: adapter,
      objects,
      apply: true,
      referencedNow: usedIn(store),
      say: line => applied.push(line),
    });

    expect(dry.code).toBe(0);
    expect(listed.join("\n")).toContain(
      `leave  its stored sizes as they are: the file of "small" is recorded by its path alone (${key})`
    );
    expect(code).toBe(1);
    expect([...adapter.files.keys()].sort()).toEqual(before);
    expect(store.cleared).toEqual([]);
    expect(holdsStoredSizes(store.table[0].sizes)).toBe(true);
    expect(report.itemsLeft.map(item => item.id)).toEqual(["replaced"]);
    expect(applied.join("\n")).toContain("media replaced");
  });
});

describe("two sizes whose keys differ only in spelling", () => {
  // An object storage keeps keys as written: `media//x.webp` and
  // `media/x.webp` are two objects. Taken for one, only the first would be
  // removed, and clearing the item would leave the second with no record.
  it("removes each by its own key, and clears the item only then", async () => {
    const adapter = new Bucket("s3");
    const original = await put(adapter, "photo.png");
    adapter.files.set("media//x.webp", Buffer.from("one"));
    adapter.files.set("media/x.webp", Buffer.from("two"));
    const store = new MemoryStore([
      {
        id: "twins",
        filename: original.path,
        url: original.url,
        thumbnailUrl: null,
        sizes: JSON.stringify({
          small: {
            path: "media//x.webp",
            url: adapter.getPublicUrl("media//x.webp"),
          },
          medium: {
            path: "media/x.webp",
            url: adapter.getPublicUrl("media/x.webp"),
          },
        }),
      },
    ]);

    const { code } = await removeStoredImageSizes({
      store,
      storage: adapter,
      objects,
      apply: true,
      referencedNow: usedIn(store),
      say: () => {},
    });

    expect(code).toBe(0);
    expect([...adapter.files.keys()]).not.toContain("media//x.webp");
    expect([...adapter.files.keys()]).not.toContain("media/x.webp");
    expect([...adapter.files.keys()]).toContain(original.path);
    expect(store.cleared).toEqual(["twins"]);
  });
});

describe("a size whose key differs from another item's original only in spelling", () => {
  /** An item whose `small` size is stored at `sizePath`, beside `original`. */
  async function itemWithSize(
    adapter: IStorageAdapter,
    sizePath: string
  ): Promise<MediaSizesRow> {
    const own = await put(adapter, "photo.png");
    return {
      id: "spelled",
      filename: own.path,
      url: own.url,
      thumbnailUrl: null,
      sizes: JSON.stringify({
        small: { path: sizePath, url: adapter.getPublicUrl(sizePath) },
      }),
    };
  }

  // An object storage keeps `media//x.webp` and `media/x.webp` as two
  // objects. Kept for the other item's original, which it is not, the size's
  // own file would stay stored once its item's record is cleared.
  it("is removed on a storage that keeps keys as written, and the original stays", async () => {
    const adapter = new Bucket("s3");
    adapter.files.set("media/x.webp", Buffer.from("original"));
    adapter.files.set("media//x.webp", Buffer.from("size"));
    const store = new MemoryStore([
      {
        id: "other",
        filename: "media/x.webp",
        url: adapter.getPublicUrl("media/x.webp"),
        thumbnailUrl: null,
        sizes: null,
      },
      await itemWithSize(adapter, "media//x.webp"),
    ]);

    const { code } = await removeStoredImageSizes({
      store,
      storage: adapter,
      objects,
      apply: true,
      referencedNow: usedIn(store, adapter),
      say: () => {},
    });

    expect(code).toBe(0);
    expect([...adapter.files.keys()]).not.toContain("media//x.webp");
    expect([...adapter.files.keys()]).toContain("media/x.webp");
    expect(store.cleared).toEqual(["spelled"]);
  });

  // A custom adapter promises nothing about spellings. This one reads both
  // as one file, the other item's original, as a filesystem-backed adapter
  // would. That file stays.
  it("is kept on a custom adapter, which may read both spellings as one file", async () => {
    const bucket = new Bucket("s3");
    const one = (filePath: string) => filePath.replace(/\/{2,}/g, "/");
    const adapter: IStorageAdapter = {
      upload: bucket.upload.bind(bucket),
      delete: filePath => bucket.delete(one(filePath)),
      exists: filePath => bucket.exists(one(filePath)),
      getPublicUrl: bucket.getPublicUrl.bind(bucket),
      getType: () => "acme-storage",
    };
    bucket.files.set("media/x.webp", Buffer.from("original"));
    const store = new MemoryStore([
      {
        id: "other",
        filename: "media/x.webp",
        url: adapter.getPublicUrl("media/x.webp"),
        thumbnailUrl: null,
        sizes: null,
      },
      await itemWithSize(adapter, "media//x.webp"),
    ]);

    const { code } = await removeStoredImageSizes({
      store,
      storage: adapter,
      objects,
      apply: true,
      referencedNow: usedIn(store, adapter),
      say: () => {},
    });

    expect(code).toBe(0);
    expect([...bucket.files.keys()]).toContain("media/x.webp");
    expect(store.cleared).toEqual(["spelled"]);
  });

  // On local disk both spellings are one file, the other item's original:
  // it stays, and the item is cleared.
  it("is kept on local disk, where both spellings are one file (the control)", async () => {
    const storage = await localDisk();
    try {
      const other = await put(storage.adapter, "x.webp");
      const respelled = other.path.replace("/", "//");
      expect(respelled).not.toBe(other.path);
      const store = new MemoryStore([
        {
          id: "other",
          filename: other.path,
          url: other.url,
          thumbnailUrl: null,
          sizes: null,
        },
        await itemWithSize(storage.adapter, respelled),
      ]);

      const { code } = await removeStoredImageSizes({
        store,
        storage: storage.adapter,
        objects,
        apply: true,
        referencedNow: usedIn(store, storage.adapter),
        say: () => {},
      });

      expect(code).toBe(0);
      expect(await storage.files()).toContain(other.path);
      expect(store.cleared).toEqual(["spelled"]);
    } finally {
      await storage.dispose();
    }
  });
});

describe("a delete that fails while the file may still be there", () => {
  /**
   * A storage whose delete of one path fails with `error`, and whose `exists`
   * answers `false` for it, as Vercel Blob's and UploadThing's do for any
   * failure to ask: a token refused or the service down.
   */
  function failingWith(
    adapter: IStorageAdapter,
    failing: string,
    error: unknown
  ): IStorageAdapter {
    return Object.assign(Object.create(adapter) as IStorageAdapter, {
      delete: async (filePath: string) => {
        if (filePath === failing) throw error;
        await adapter.delete(filePath);
      },
      exists: async (filePath: string) =>
        filePath === failing ? false : adapter.exists(filePath),
    });
  }

  it("keeps the item's sizes and exits non-zero, whatever exists() answers", async () => {
    const storage = bucket("vercel-blob");
    const { small, large, store } = await oneItem(storage.adapter);
    const lines: string[] = [];

    const { code, report } = await removeStoredImageSizes({
      store,
      storage: failingWith(
        storage.adapter,
        large.path,
        new Error("Vercel Blob: Access denied, please provide a valid token")
      ),
      objects,
      apply: true,
      referencedNow: usedIn(store),
      say: line => lines.push(line),
    });

    expect(code).toBe(1);
    expect(store.cleared).toEqual([]);
    expect(holdsStoredSizes(store.table[0].sizes)).toBe(true);
    expect(report.itemsLeft.map(item => item.id)).toEqual(["item"]);
    expect(lines.join("\n")).toContain(`could not remove ${large.path}`);
    // The file that could go went; the record of both stays for a later run.
    expect(await storage.files()).not.toContain(small.path);
    expect(await storage.files()).toContain(large.path);
  });

  it("counts a file the storage's own error says is gone as removed (the control)", async () => {
    const storage = bucket("s3");
    const { large, store } = await oneItem(storage.adapter);
    const gone = Object.assign(new Error("The specified key does not exist."), {
      name: "NoSuchKey",
      $metadata: { httpStatusCode: 404 },
    });

    const { code } = await removeStoredImageSizes({
      store,
      storage: failingWith(storage.adapter, large.path, gone),
      objects,
      apply: true,
      referencedNow: usedIn(store),
      say: () => {},
    });

    expect(code).toBe(0);
    expect(store.cleared).toEqual(["item"]);
  });

  // A 404 says something is not found, not that the file is: a bucket that
  // does not exist, or a storage reached at the wrong address, answers 404
  // too, while the file itself may still be served from where it is.
  it.each([
    [
      "a bucket that does not exist",
      Object.assign(new Error("The specified bucket does not exist"), {
        name: "NoSuchBucket",
        $metadata: { httpStatusCode: 404 },
      }),
    ],
    [
      "a bare 404 from a storage's endpoint",
      Object.assign(new Error("404 page not found"), {
        $metadata: { httpStatusCode: 404 },
      }),
    ],
    [
      "an error named only NotFound",
      Object.assign(new Error("Not Found"), { name: "NotFound" }),
    ],
  ])(
    "keeps the item's sizes for %s, which does not say the file is gone",
    async (_case, error) => {
      const storage = bucket("s3");
      const { large, store } = await oneItem(storage.adapter);

      const { code, report } = await removeStoredImageSizes({
        store,
        storage: failingWith(storage.adapter, large.path, error),
        objects,
        apply: true,
        referencedNow: usedIn(store),
        say: () => {},
      });

      expect(code).toBe(1);
      expect(store.cleared).toEqual([]);
      expect(holdsStoredSizes(store.table[0].sizes)).toBe(true);
      expect(report.itemsLeft.map(item => item.id)).toEqual(["item"]);
    }
  );
});

describe("a size file two items name", () => {
  // An import can copy a record, so two items' `sizes` can name one stored
  // file. Whether it goes is one decision for every item naming it: removed
  // for one while another keeps its record of it, that record names nothing.

  /** Two items on `adapter` whose `small` sizes name one stored file. */
  async function twoItemsSharing(adapter: IStorageAdapter, extraOfB = {}) {
    const first = await put(adapter, "first.png");
    const second = await put(adapter, "second.png");
    const shared = await storedSize(adapter, "shared-small.webp");
    const store = new MemoryStore([
      {
        id: "first",
        filename: first.path,
        url: first.url,
        thumbnailUrl: null,
        sizes: JSON.stringify({ small: shared }),
      },
      {
        id: "second",
        filename: second.path,
        url: second.url,
        thumbnailUrl: null,
        sizes: JSON.stringify({ small: shared, ...extraOfB }),
      },
    ]);
    return { shared, store };
  }

  /** `adapter`, counting the deletes it is asked for, by path. */
  function counting(adapter: IStorageAdapter) {
    const deletes: string[] = [];
    const storage = Object.assign(Object.create(adapter) as IStorageAdapter, {
      delete: async (filePath: string) => {
        deletes.push(filePath);
        await adapter.delete(filePath);
      },
    });
    return { storage, deletes };
  }

  it("is kept while an item left as it is names it, and that item's record stays", async () => {
    const adapter = new Bucket("s3");
    // The second item also has a size recorded by its path alone, which
    // leaves it as it is.
    const { shared, store } = await twoItemsSharing(adapter, {
      medium: { path: "2026/10/second-medium.webp" },
    });
    const listed: string[] = [];

    const dry = await removeStoredImageSizes({
      store,
      storage: adapter,
      objects,
      apply: false,
      referencedNow: usedIn(store),
      say: line => listed.push(line),
    });
    const { code, report } = await removeStoredImageSizes({
      store,
      storage: adapter,
      objects,
      apply: true,
      referencedNow: usedIn(store),
      say: () => {},
    });

    // The first item's part of the listing, up to the second item's heading.
    const firstItem = listed
      .slice(
        listed.findIndex(line => line.startsWith("media first")),
        listed.findIndex(line => line.startsWith("media second"))
      )
      .join("\n");
    expect(dry.code).toBe(0);
    expect(firstItem).toContain(
      `keep   ${shared.path} (size "small": an item left as it is names it too)`
    );
    expect(firstItem).not.toContain(`remove ${shared.path}`);
    expect(code).toBe(1);
    expect([...adapter.files.keys()]).toContain(shared.path);
    expect(report.itemsLeft.map(item => item.id)).toEqual(["second"]);
    expect(holdsStoredSizes(store.table[1].sizes)).toBe(true);
    // The first item's record goes: the second's still names the file.
    expect(store.cleared).toEqual(["first"]);
  });

  it("is kept for every item naming it when its delete fails, and none of them is cleared", async () => {
    const adapter = new Bucket("s3");
    const { shared, store } = await twoItemsSharing(adapter);
    // Refused once, then allowed: a later item asking again would succeed.
    let refused = false;
    const storage = Object.assign(Object.create(adapter) as IStorageAdapter, {
      delete: async (filePath: string) => {
        if (filePath === shared.path && !refused) {
          refused = true;
          throw new Error("Access Denied");
        }
        await adapter.delete(filePath);
      },
    });
    const lines: string[] = [];

    const { code, report } = await removeStoredImageSizes({
      store,
      storage,
      objects,
      apply: true,
      referencedNow: usedIn(store),
      say: line => lines.push(line),
    });

    expect(code).toBe(1);
    expect([...adapter.files.keys()]).toContain(shared.path);
    expect(store.cleared).toEqual([]);
    expect(report.itemsLeft.map(item => item.id)).toEqual(["first", "second"]);
    expect(
      lines.filter(line => line.includes(`could not remove ${shared.path}`))
    ).toHaveLength(2);
  });

  it("is removed once, and every item naming it cleared, when nothing holds it (the control)", async () => {
    const adapter = new Bucket("s3");
    const { shared, store } = await twoItemsSharing(adapter);
    const { storage, deletes } = counting(adapter);

    const { code, report } = await removeStoredImageSizes({
      store,
      storage,
      objects,
      apply: true,
      referencedNow: usedIn(store),
      say: () => {},
    });

    expect(code).toBe(0);
    expect([...adapter.files.keys()]).not.toContain(shared.path);
    expect(deletes).toEqual([shared.path]);
    expect(report.filesRemoved).toBe(1);
    expect(store.cleared).toEqual(["first", "second"]);
  });
});

describe("sizes stored on another storage than the one configured now", () => {
  // The key is the same, the storage is not: the size's file is the old
  // bucket's, and another item's original is this bucket's. Taken as in use
  // by its path, the size would be kept here and the item cleared, leaving
  // the old bucket's file served with nothing naming it.
  it("are refused when the key collides with an original on this storage", async () => {
    const adapter = new Bucket("s3");
    const key = "2026/10/photo.png";
    const current = await put(adapter, "own.png");
    adapter.files.set(key, Buffer.from("another item's original"));
    const store = new MemoryStore([
      {
        id: "moved",
        filename: current.path,
        url: current.url,
        thumbnailUrl: null,
        sizes: JSON.stringify({
          small: {
            path: key,
            url: `https://old-bucket.s3.us-east-1.amazonaws.com/${key}`,
          },
        }),
      },
      {
        id: "other",
        filename: key,
        url: adapter.getPublicUrl(key),
        thumbnailUrl: null,
        sizes: null,
      },
    ]);
    const before = [...adapter.files.keys()].sort();
    const lines: string[] = [];

    const { code, report } = await removeStoredImageSizes({
      store,
      storage: adapter,
      objects,
      apply: true,
      referencedNow: usedIn(store),
      say: line => lines.push(line),
    });

    expect(code).toBe(1);
    expect(store.cleared).toEqual([]);
    expect(holdsStoredSizes(store.table[0].sizes)).toBe(true);
    expect([...adapter.files.keys()].sort()).toEqual(before);
    expect(report.itemsLeft.map(item => item.id)).toEqual(["moved"]);
    expect(lines.join("\n")).toContain(
      "is not on the media storage configured now (s3), but at https://old-bucket.s3.us-east-1.amazonaws.com/2026/10/photo.png"
    );
  });

  // The control: a size whose very URL another item uses is that item's
  // file, wherever it is served from, and is kept for it.
  it("keep a size whose exact URL another item uses, and clear the item", async () => {
    const adapter = new Bucket("s3");
    const shared = "https://cdn.example.com/2026/10/shared.webp";
    const current = await put(adapter, "own.png");
    const store = new MemoryStore([
      {
        id: "sizes",
        filename: current.path,
        url: current.url,
        thumbnailUrl: null,
        sizes: JSON.stringify({
          small: { path: "2026/10/shared.webp", url: shared },
        }),
      },
      {
        id: "user",
        filename: "elsewhere/shared.webp",
        url: "https://cdn.example.com/elsewhere/shared.webp",
        thumbnailUrl: shared,
        sizes: null,
      },
    ]);
    const before = [...adapter.files.keys()].sort();

    const { code } = await removeStoredImageSizes({
      store,
      storage: adapter,
      objects,
      apply: true,
      referencedNow: usedIn(store),
      say: () => {},
    });

    expect(code).toBe(0);
    expect(store.cleared).toEqual(["sizes"]);
    expect([...adapter.files.keys()].sort()).toEqual(before);
  });

  // A URL relative to the site was written by local disk, which serves files
  // from the site itself. An object storage serves from its own host, so the
  // same path under it is another file: the local one would stay, publicly
  // served, once its record was cleared.
  it.each([
    ["by their own site-relative URL", true],
    ["by path alone, beside a site-relative original", false],
  ])(
    "are refused on an object storage when recorded %s",
    async (_case, sizeHasUrl) => {
      const adapter = new Bucket("s3");
      const key = "2026/10/photo-small.webp";
      // The bucket holds its own file at the very key the record names.
      adapter.files.set(key, Buffer.from("this bucket's own file"));
      adapter.files.set("2026/10/photo.png", Buffer.from("original"));
      const store = new MemoryStore([
        {
          id: "from-disk",
          filename: "2026/10/photo.png",
          url: "/2026/10/photo.png",
          thumbnailUrl: null,
          sizes: JSON.stringify({
            small: sizeHasUrl ? { path: key, url: `/${key}` } : { path: key },
          }),
        },
      ]);
      const before = [...adapter.files.keys()].sort();

      const { code, report } = await removeStoredImageSizes({
        store,
        storage: adapter,
        objects,
        apply: true,
        referencedNow: usedIn(store),
        say: () => {},
      });

      expect(code).toBe(1);
      expect([...adapter.files.keys()].sort()).toEqual(before);
      expect(store.cleared).toEqual([]);
      expect(report.itemsLeft.map(item => item.id)).toEqual(["from-disk"]);
    }
  );

  it("are refused: nothing is sent to this storage, the item keeps its sizes and is named", async () => {
    const adapter = new Bucket("s3");
    const storage: Storage = {
      adapter,
      files: async () => [...adapter.files.keys()].sort(),
    };
    const original = await put(adapter, "photo.png");
    // Uploaded when media was on another bucket. This bucket holds a file at
    // the very same key, which a path sent here would delete.
    const key = "2026/10/old-photo-small.webp";
    adapter.files.set(key, Buffer.from("this bucket's own file"));
    const store = new MemoryStore([
      {
        id: "moved",
        filename: original.path,
        url: original.url,
        thumbnailUrl: null,
        sizes: JSON.stringify({
          small: {
            path: key,
            url: `https://old-bucket.s3.us-east-1.amazonaws.com/${key}?X-Amz-Signature=sekrit`,
          },
        }),
      },
    ]);
    const before = await storage.files();
    const listed: string[] = [];
    const applied: string[] = [];

    const dry = await removeStoredImageSizes({
      store,
      storage: storage.adapter,
      objects,
      apply: false,
      referencedNow: usedIn(store),
      say: line => listed.push(line),
    });
    const { code, report } = await removeStoredImageSizes({
      store,
      storage: storage.adapter,
      objects,
      apply: true,
      referencedNow: usedIn(store),
      say: line => applied.push(line),
    });

    expect(dry.code).toBe(0);
    expect(listed.join("\n")).toContain(
      'leave  its stored sizes as they are: the file of "small" is not on the media storage configured now (s3), but at https://old-bucket.s3.us-east-1.amazonaws.com/2026/10/old-photo-small.webp'
    );
    expect(code).toBe(1);
    expect(await storage.files()).toEqual(before);
    expect(store.cleared).toEqual([]);
    expect(report.itemsLeft.map(item => item.id)).toEqual(["moved"]);
    expect(applied.join("\n")).toContain("moved");
    expect(applied.join("\n")).not.toContain("sekrit");
  });

  it("are removed when they are on this storage, under a site-relative or absolute URL (the control)", async () => {
    const storage = await localDisk();
    disposals.push(storage.dispose);
    const original = await put(storage.adapter, "photo.png");
    const small = await storedSize(storage.adapter, "photo-small.webp");
    const store = new MemoryStore([
      {
        id: "here",
        filename: original.path,
        url: `https://www.example.com${original.url}`,
        thumbnailUrl: null,
        sizes: JSON.stringify({
          small: { ...small, url: `https://www.example.com${small.url}` },
        }),
      },
    ]);

    const { code } = await removeStoredImageSizes({
      store,
      storage: storage.adapter,
      objects,
      apply: true,
      referencedNow: usedIn(store),
      say: () => {},
    });

    expect(code).toBe(0);
    expect(await storage.files()).not.toContain(small.path);
    expect(store.cleared).toEqual(["here"]);
  });
});

describe("what items use, asked again just before the removal", () => {
  it("keeps a file an item came to use after the listing", async () => {
    const storage = bucket("s3");
    const { original, small, large, store } = await oneItem(storage.adapter);
    // An upload committing between the listing and the removal, whose
    // original is stored under the key one of the sizes has.
    const rows = store.rows.bind(store);
    store.rows = async function* () {
      yield* rows();
      store.table.push({
        id: "new-upload",
        filename: small.path,
        url: small.url,
        thumbnailUrl: null,
        sizes: null,
      });
    };

    const { code } = await removeStoredImageSizes({
      store,
      storage: storage.adapter,
      objects,
      apply: true,
      referencedNow: usedIn(store),
      say: () => {},
    });

    expect(code).toBe(0);
    expect(await storage.files()).toEqual(
      expect.arrayContaining([original.path, small.path])
    );
    expect(await storage.files()).not.toContain(large.path);
  });

  it("removes nothing more, and leaves every item not done, when it cannot be answered", async () => {
    const storage = bucket("s3");
    const { small, large, store } = await oneItem(storage.adapter);
    const before = await storage.files();
    const lines: string[] = [];

    const { code, report } = await removeStoredImageSizes({
      store,
      storage: storage.adapter,
      objects,
      apply: true,
      referencedNow: async () => null,
      say: line => lines.push(line),
    });

    expect(code).toBe(1);
    expect(await storage.files()).toEqual(before);
    expect(await storage.files()).toEqual(
      expect.arrayContaining([small.path, large.path])
    );
    expect(store.cleared).toEqual([]);
    expect(report.itemsLeft.map(item => item.id)).toEqual(["item"]);
    expect(lines.join("\n")).toContain("could not be checked");
  });
});

describe("holdsStoredSizes", () => {
  it("reads NULL, an empty object and an empty list as none, and anything unreadable as some", () => {
    expect(
      [null, undefined, "{}", {}, "[]", "null", '{"s":{"path":"a"}}', "{x"].map(
        holdsStoredSizes
      )
    ).toEqual([false, false, false, false, false, false, true, true]);
  });
});
