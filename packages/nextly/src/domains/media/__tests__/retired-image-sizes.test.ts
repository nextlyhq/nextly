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
import { canonicalStoredPath, type ReferencedNow } from "../orphan-thumbnails";
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
 * reads each row, without the retired sizes. The check itself, over a real
 * media table, is the CLI's (`referencedNowIn`), covered beside the command.
 */
function usedIn(store: MemoryStore): ReferencedNow {
  return async paths => {
    const used = new Set(
      store.table.flatMap(row =>
        storedFilesOf({ ...row, sizes: undefined }).paths.map(
          canonicalStoredPath
        )
      )
    );
    return new Set(paths.filter(path => used.has(canonicalStoredPath(path))));
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
});

describe("sizes stored on another storage than the one configured now", () => {
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
