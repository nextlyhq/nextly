/**
 * `nextly media orphans`: the upload-time thumbnails earlier deletes left in
 * the media storage, listed, and with --apply removed.
 *
 * Each storage holds a thumbnail an item refers to, a left-behind one stored
 * two hours ago, a left-behind one stored a minute ago (which may belong to
 * an upload still in progress), a file of the thumbnail form under another
 * collection's prefix, and an ordinary unreferenced file. Only the old
 * left-behind thumbnail is media's to remove. Local disk uses real files;
 * S3, Vercel Blob and UploadThing a stand-in that lists files as they do.
 * Media's files are under its own prefix, `media`, which nothing else on the
 * storage shares, so its place shows they are media's.
 */
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalStorageAdapter } from "../../../storage/adapters/local-adapter";
import type {
  IStorageAdapter,
  StoredFileEntry,
  UploadOptions,
} from "../../../storage/types";
import { mediaPlaceIsExclusive } from "../../../domains/media/orphan-thumbnails";
import type { ReferencedNow } from "../../../domains/media/orphan-thumbnails";
import { mediaOrphans, type MediaReferences } from "../media";

const NOW = new Date("2026-10-18T12:00:00Z");
const TWO_HOURS_AGO = new Date(NOW.getTime() - 2 * 3_600_000);
const A_MINUTE_AGO = new Date(NOW.getTime() - 60_000);
const key = (name: string, folder = "") =>
  `${folder}2026/10/${randomUUID()}-${name}`;

/**
 * `referencedNow` as the listing's references answer it, asked afresh for
 * each file: `null` while one of them cannot be located.
 */
const askedOf =
  (referenced: () => Promise<MediaReferences>): ReferencedNow =>
  async files => {
    const now = await referenced();
    return now.unlocated.length > 0
      ? null
      : new Set(files.filter(file => now.paths.has(file)));
  };

/** What the media table refers to: these stored paths, all located. */
const refs = (...paths: string[]): MediaReferences => ({
  paths: new Set(paths),
  unlocated: [],
});

/** Stored files with their times and, for UploadThing, uploaded names. */
class Bucket implements IStorageAdapter {
  readonly files = new Map<string, StoredFileEntry>();
  failOn?: string;
  constructor(private readonly scheme: "s3" | "vercel-blob" | "uploadthing") {}
  put(entry: StoredFileEntry) {
    this.files.set(entry.path, entry);
  }
  async *list() {
    yield* this.files.values();
  }
  async delete(filePath: string) {
    if (filePath === this.failOn) throw new Error("storage is unavailable");
    this.files.delete(filePath);
  }
  async upload(_buffer: Buffer, _options: UploadOptions): Promise<never> {
    throw new Error("not used");
  }
  async exists(filePath: string) {
    return this.files.has(filePath);
  }
  getPublicUrl(filePath: string) {
    return filePath;
  }
  getType() {
    return this.scheme;
  }
}

interface Layout {
  storage: IStorageAdapter;
  stored: () => Promise<string[]>;
  referenced: string;
  orphan: string;
  recent: string;
  elsewhere: string;
  ordinary: string;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "nextly-orphans-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function onLocalDisk(): Promise<Layout> {
  const files = {
    referenced: key("thumb_a.png", "media/"),
    orphan: key("thumb_b.png", "media/"),
    recent: key("thumb_c.png", "media/"),
    elsewhere: key("thumb_d.png", "docs/"),
    ordinary: key("photo.png", "media/"),
  };
  for (const [which, file] of Object.entries(files)) {
    const full = path.join(dir, file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, "x");
    const time = which === "recent" ? A_MINUTE_AGO : TWO_HOURS_AGO;
    await utimes(full, time, time);
  }
  const storage = new LocalStorageAdapter({
    basePath: dir,
    baseUrl: "/uploads",
  });
  const stored = async () =>
    (await readdir(dir, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile())
      // As a stored path is written, with `/` on every platform.
      .map(entry =>
        path
          .relative(dir, path.join(entry.parentPath, entry.name))
          .split(path.sep)
          .join("/")
      )
      .sort();
  return { storage, stored, ...files };
}

function inBucket(scheme: "s3" | "vercel-blob" | "uploadthing"): Layout {
  const bucket = new Bucket(scheme);
  const at = (path: string, lastModified: Date, name?: string) => {
    bucket.put({ path, lastModified, ...(name ? { name } : {}) });
    return path;
  };
  const blob = (name: string, folder = "") =>
    `https://abc123.public.blob.vercel-storage.com/${folder}${name.replace(".png", `-${randomUUID().slice(0, 8)}.png`)}`;
  const files =
    scheme === "s3"
      ? {
          referenced: at(key("thumb_a.png", "media/"), TWO_HOURS_AGO),
          orphan: at(key("thumb_b.png", "media/"), TWO_HOURS_AGO),
          recent: at(key("thumb_c.png", "media/"), A_MINUTE_AGO),
          elsewhere: at(key("thumb_d.png", "docs/"), TWO_HOURS_AGO),
          ordinary: at(key("photo.png", "media/"), TWO_HOURS_AGO),
        }
      : scheme === "vercel-blob"
        ? {
            referenced: at(blob("thumb_a.png", "media/"), TWO_HOURS_AGO),
            orphan: at(blob("thumb_b.png", "media/"), TWO_HOURS_AGO),
            recent: at(blob("thumb_c.png", "media/"), A_MINUTE_AGO),
            elsewhere: at(blob("thumb_d.png", "docs/"), TWO_HOURS_AGO),
            ordinary: at(blob("photo.png", "media/"), TWO_HOURS_AGO),
          }
        : {
            // UploadThing keeps no folders and its keys carry no name.
            referenced: at(randomUUID(), TWO_HOURS_AGO, "thumb_a.png"),
            orphan: at(randomUUID(), TWO_HOURS_AGO, "thumb_b.png"),
            recent: at(randomUUID(), A_MINUTE_AGO, "thumb_c.png"),
            elsewhere: at(randomUUID(), TWO_HOURS_AGO, "docs-thumb_d.png"),
            ordinary: at(randomUUID(), TWO_HOURS_AGO, "photo.png"),
          };
  return {
    storage: bucket,
    stored: async () => [...bucket.files.keys()].sort(),
    ...files,
  };
}

const layouts: Array<[string, () => Promise<Layout> | Layout]> = [
  ["local disk", onLocalDisk],
  ["s3", () => inBucket("s3")],
  ["vercel-blob", () => inBucket("vercel-blob")],
  ["uploadthing", () => inBucket("uploadthing")],
];

async function run(
  layout: Layout,
  apply: boolean,
  referenced?: () => Promise<MediaReferences>,
  place: { prefix?: string; exclusive: boolean } = {
    prefix: "media",
    exclusive: true,
  }
) {
  const said: string[] = [];
  const code = await mediaOrphans({
    storage: layout.storage,
    ...place,
    referenced: referenced ?? (async () => refs(layout.referenced)),
    referencedNow: askedOf(referenced ?? (async () => refs(layout.referenced))),
    apply,
    say: line => said.push(line),
    now: NOW,
  });
  return { code, said: said.join("\n") };
}

describe("nextly media orphans", () => {
  it.each(layouts)(
    "lists only the old left-behind thumbnail on %s, and changes nothing",
    async (_label, make) => {
      const layout = await make();
      const before = await layout.stored();

      const { code, said } = await run(layout, false);

      expect(code).toBe(0);
      expect(said).toContain(layout.orphan);
      for (const other of [
        layout.referenced,
        layout.recent,
        layout.elsewhere,
        layout.ordinary,
      ]) {
        expect(said).not.toContain(other);
      }
      expect(await layout.stored()).toEqual(before);
    }
  );

  // Where a thumbnail's place shows it is media's: under media's prefix, in
  // a form only media uploads give it.
  it.each(layouts.filter(([label]) => label !== "uploadthing"))(
    "removes only the old left-behind thumbnail on %s with --apply, and names it",
    async (_label, make) => {
      const layout = await make();
      const before = await layout.stored();

      const { code, said } = await run(layout, true);

      expect(code).toBe(0);
      expect(said).toContain(`Removed ${layout.orphan}`);
      expect(await layout.stored()).toEqual(
        before.filter(file => file !== layout.orphan)
      );
    }
  );

  // UploadThing keeps no folders and its keys carry no name, so a thumbnail
  // there is known only by the name it was uploaded under, which another
  // uploader in the same app can give a file too. It is listed for the site
  // to check, by its key and that name, and never removed.
  it("lists the old left-behind thumbnail on uploadthing as one to check, and --apply leaves it", async () => {
    const layout = inBucket("uploadthing");
    const before = await layout.stored();

    const { code, said } = await run(layout, true);

    expect(code).toBe(0);
    expect(await layout.stored()).toEqual(before);
    expect(said).not.toMatch(/^Removed /m);
    const line = said.split("\n").find(text => text.includes(layout.orphan));
    expect(line).toBeDefined();
    expect(line).toContain("thumb_b.png");
    expect(said).toMatch(/by hand/);
    for (const other of [layout.referenced, layout.recent, layout.ordinary]) {
      expect(said).not.toContain(other);
    }
  });

  // Where media's prefix is not its own, another collection can store a file
  // of the same form in the same place, so nothing shows a match is media's.
  it.each(layouts.filter(([label]) => label !== "uploadthing"))(
    "lists the old left-behind thumbnail on %s as one to check when media's prefix is shared, and --apply leaves it",
    async (_label, make) => {
      const layout = await make();
      const before = await layout.stored();

      const { code, said } = await run(layout, true, undefined, {
        prefix: "media",
        exclusive: false,
      });

      expect(code).toBe(0);
      expect(await layout.stored()).toEqual(before);
      expect(said).not.toMatch(/^Removed /m);
      expect(said).toContain(layout.orphan);
      expect(said).toMatch(/by hand/);
      expect(said).toMatch(/Set a `prefix` for media/);
    }
  );

  it("names the collections that share media's place, and that each needs a prefix of its own", async () => {
    const layout = inBucket("s3");
    const said: string[] = [];

    await mediaOrphans({
      storage: layout.storage,
      prefix: "media",
      exclusive: false,
      sharedWith: ["docs", "invoices"],
      referenced: async () => refs(layout.referenced),
      referencedNow: askedOf(async () => refs(layout.referenced)),
      apply: true,
      say: line => said.push(line),
      now: NOW,
    });

    const text = said.join("\n");
    expect(text).toMatch(/docs/);
    expect(text).toMatch(/invoices/);
    expect(text).toMatch(/`prefix` of its own/);
    expect(text).not.toMatch(/Set a `prefix` for media/);
  });

  // A prefix written with its slash, `media/`, is stored as `media//...`
  // where the storage keeps keys as given (S3), and read back as
  // `media/...` where a filesystem collapses the separator (local disk).
  // Either way a referenced file must count as referenced.
  it("matches a `media/` prefix on S3, whose keys keep the doubled slash", async () => {
    const bucket = new Bucket("s3");
    const at = (name: string) => {
      const path = key(name, "media//");
      bucket.put({ path, lastModified: TWO_HOURS_AGO });
      return path;
    };
    const referenced = at("thumb_a.png");
    const orphan = at("thumb_b.png");
    const said: string[] = [];

    const code = await mediaOrphans({
      storage: bucket,
      prefix: "media/",
      exclusive: true,
      referenced: async () => refs(referenced),
      referencedNow: askedOf(async () => refs(referenced)),
      apply: true,
      say: line => said.push(line),
      now: NOW,
    });

    expect(code).toBe(0);
    expect([...bucket.files.keys()]).toEqual([referenced]);
    expect(said.join("\n")).toContain(`Removed ${orphan}`);
  });

  it("keeps a referenced thumbnail on local disk whose record spells the prefix `media//`", async () => {
    const layout = await onLocalDisk();
    const recorded = layout.referenced.replace("media/", "media//");
    const said: string[] = [];

    const code = await mediaOrphans({
      storage: layout.storage,
      prefix: "media/",
      exclusive: true,
      referenced: async () => refs(recorded),
      referencedNow: askedOf(async () => refs(recorded)),
      apply: true,
      say: line => said.push(line),
      now: NOW,
    });

    expect(code).toBe(0);
    const stored = await layout.stored();
    expect(stored).toContain(layout.referenced);
    expect(stored).not.toContain(layout.orphan);
  });

  // S3 keeps a key as written: `/media/...` and `media//...` are other keys
  // than the `media/...` uploads under a `media` prefix make, and may be
  // anything's.
  it("leaves S3 keys spelled otherwise than media's prefix makes them", async () => {
    const bucket = new Bucket("s3");
    const outside = [
      key("thumb_a.png", "/media/"),
      key("thumb_b.png", "media//"),
    ];
    for (const path of outside)
      bucket.put({ path, lastModified: TWO_HOURS_AGO });
    const said: string[] = [];

    const code = await mediaOrphans({
      storage: bucket,
      prefix: "media",
      exclusive: true,
      referenced: async () => refs(),
      referencedNow: async () => new Set(),
      apply: true,
      say: line => said.push(line),
      now: NOW,
    });

    expect(code).toBe(0);
    expect([...bucket.files.keys()].sort()).toEqual([...outside].sort());
  });

  // Vercel Blob writes a prefix's trailing slash once: `media/` stores
  // `media/thumb_...`.
  it("finds a thumbnail on Vercel Blob under a prefix written with its slash", async () => {
    const bucket = new Bucket("vercel-blob");
    const path =
      "https://abc.public.blob.vercel-storage.com/media/thumb_x-1a2b.png";
    bucket.put({ path, lastModified: TWO_HOURS_AGO });

    await mediaOrphans({
      storage: bucket,
      prefix: "media/",
      exclusive: true,
      referenced: async () => refs(),
      referencedNow: async () => new Set(),
      apply: true,
      say: () => {},
      now: NOW,
    });

    expect(bucket.files.size).toBe(0);
  });

  // A storage of another kind may keep keys as written too; only local disk
  // is known to read every spelling as one.
  it("leaves keys spelled otherwise on a storage of a kind it does not know", async () => {
    const bucket = new Bucket("s3");
    // The same files, under a kind of storage this does not know.
    const custom: IStorageAdapter = Object.assign(
      Object.create(Object.getPrototypeOf(bucket)),
      bucket,
      { getType: () => "custom-store" }
    );
    const outside = [
      key("thumb_a.png", "/media/"),
      key("thumb_b.png", "media//"),
    ];
    for (const path of outside)
      bucket.put({ path, lastModified: TWO_HOURS_AGO });

    await mediaOrphans({
      storage: custom,
      prefix: "media",
      exclusive: true,
      referenced: async () => refs(),
      referencedNow: async () => new Set(),
      apply: true,
      say: () => {},
      now: NOW,
    });

    expect([...bucket.files.keys()].sort()).toEqual([...outside].sort());
  });

  // A prefix written with a leading slash, `/media`, is recorded as
  // `/media/...`, and listed by local disk relative to its folder, as
  // `media/...`.
  it("keeps a referenced thumbnail on local disk whose record spells the prefix `/media`", async () => {
    const layout = await onLocalDisk();
    const recorded = `/${layout.referenced}`;
    const said: string[] = [];

    const code = await mediaOrphans({
      storage: layout.storage,
      prefix: "/media",
      exclusive: true,
      referenced: async () => refs(recorded),
      referencedNow: askedOf(async () => refs(recorded)),
      apply: true,
      say: line => said.push(line),
      now: NOW,
    });

    expect(code).toBe(0);
    const stored = await layout.stored();
    expect(stored).toContain(layout.referenced);
    expect(stored).not.toContain(layout.orphan);
  });

  it("matches a `/media` prefix on S3, whose keys keep the leading slash", async () => {
    const bucket = new Bucket("s3");
    const at = (name: string) => {
      const path = key(name, "/media/");
      bucket.put({ path, lastModified: TWO_HOURS_AGO });
      return path;
    };
    const referenced = at("thumb_a.png");
    const orphan = at("thumb_b.png");
    const said: string[] = [];

    const code = await mediaOrphans({
      storage: bucket,
      prefix: "/media",
      exclusive: true,
      referenced: async () => refs(referenced),
      referencedNow: askedOf(async () => refs(referenced)),
      apply: true,
      say: line => said.push(line),
      now: NOW,
    });

    expect(code).toBe(0);
    expect([...bucket.files.keys()]).toEqual([referenced]);
    expect(said.join("\n")).toContain(`Removed ${orphan}`);
  });

  // A thumbnail in use whose stored location the record does not show can
  // be any listed file, so with one nothing is removed.
  it("removes nothing, and lists what it found, while a thumbnail in use cannot be located", async () => {
    const layout = await onLocalDisk();
    const thumbnailUrl = "https://cdn.example.com/m/7/thumb";

    const { code, said } = await run(layout, true, async () => ({
      paths: new Set([layout.referenced]),
      unlocated: [thumbnailUrl],
    }));

    expect(code).toBe(0);
    expect(await layout.stored()).toContain(layout.orphan);
    expect(said).toContain(`  ${layout.orphan}`);
    expect(said).toMatch(
      /1 media item\(s\) have a thumbnail whose stored location/
    );
    expect(said).not.toContain("Removed");
  });

  // A thumbnail in use that cannot be located can appear between the
  // listing and a removal, as an upload commits.
  it("stops removing once a recheck finds a thumbnail in use it cannot locate", async () => {
    const layout = inBucket("s3");
    let reads = 0;
    const referenced = async () =>
      reads++ === 0
        ? refs(layout.referenced)
        : {
            paths: new Set([layout.referenced]),
            unlocated: ["https://cdn.example.com/m/7/thumb"],
          };

    const { code, said } = await run(layout, true, referenced);

    expect(code).toBe(1);
    expect(await layout.stored()).toContain(layout.orphan);
    expect(said).not.toContain("Removed");
    expect(said).toMatch(/could not be checked just before their removal/);
  });

  // An item can come to refer to a listed file while earlier ones go: each
  // batch is asked about just before its own removals, in one search.
  it("asks about each batch of files just before removing it", async () => {
    const bucket = new Bucket("s3");
    for (let i = 0; i < 120; i++) {
      bucket.put({
        path: key(`thumb_${i}.png`, "media/"),
        lastModified: TWO_HOURS_AGO,
      });
    }
    const events: Array<{ ask: string[] } | { remove: string }> = [];
    const remove = bucket.delete.bind(bucket);
    bucket.delete = async (file: string) => {
      events.push({ remove: file });
      return remove(file);
    };

    const code = await mediaOrphans({
      storage: bucket,
      prefix: "media",
      exclusive: true,
      referenced: async () => refs(),
      referencedNow: async files => {
        events.push({ ask: [...files] });
        return new Set();
      },
      apply: true,
      say: () => {},
      now: NOW,
    });

    expect(code).toBe(0);
    expect(bucket.files.size).toBe(0);
    const asks = events.filter(event => "ask" in event);
    expect(asks).toHaveLength(Math.ceil(120 / 50));
    // Each file goes after the ask that named it, and before the next ask.
    let asked = new Set<string>();
    for (const event of events) {
      if ("ask" in event) asked = new Set(event.ask);
      else expect(asked.has(event.remove)).toBe(true);
    }
  });

  // An adapter can list a file by a signed URL.
  it("prints the files it lists and removes without their URLs' secrets", async () => {
    const bucket = new Bucket("vercel-blob");
    const signed =
      "https://abc.public.blob.vercel-storage.com/media/thumb_x.png?token=token-secret";
    bucket.put({ path: signed, lastModified: TWO_HOURS_AGO });
    const said: string[] = [];

    await mediaOrphans({
      storage: bucket,
      prefix: "media",
      exclusive: true,
      referenced: async () => refs(),
      referencedNow: async () => new Set(),
      apply: true,
      say: line => said.push(line),
      now: NOW,
    });

    const text = said.join("\n");
    expect(text).toContain(
      "https://abc.public.blob.vercel-storage.com/media/thumb_x.png"
    );
    expect(text).not.toMatch(/secret/);
  });

  // A listing can name a file by a signed URL, which a record names
  // without its query: the same file.
  it("keeps a referenced file the storage lists by a signed URL", async () => {
    const bucket = new Bucket("vercel-blob");
    const url = "https://abc.public.blob.vercel-storage.com/media/thumb_x.png";
    bucket.put({ path: `${url}?token=t1`, lastModified: TWO_HOURS_AGO });
    const said: string[] = [];

    await mediaOrphans({
      storage: bucket,
      prefix: "media",
      exclusive: true,
      referenced: async () => refs(url),
      referencedNow: askedOf(async () => refs(url)),
      apply: true,
      say: line => said.push(line),
      now: NOW,
    });

    expect(bucket.files.size).toBe(1);
    expect(said.join("\n")).not.toMatch(/Removed/);
  });

  // A time the storage could not read is no time: the file may belong to an
  // upload still in progress.
  it("leaves a file whose stored time is not a date", async () => {
    const layout = inBucket("s3");
    (layout.storage as Bucket).put({
      path: layout.orphan,
      lastModified: new Date(Number.NaN),
    });

    const { said } = await run(layout, true);

    expect(await layout.stored()).toContain(layout.orphan);
    expect(said).not.toContain(`Removed ${layout.orphan}`);
  });

  // What the storage said can quote a signed URL.
  it("names a failed removal without the secrets in the storage's error", async () => {
    const layout = inBucket("s3");
    (layout.storage as Bucket).delete = async () => {
      throw new Error(
        "refused https://bucket.example/x.png?X-Amz-Signature=signed-secret"
      );
    };

    const { code, said } = await run(layout, true);

    expect(code).toBe(1);
    expect(said).toContain(`Could not remove ${layout.orphan}`);
    expect(said).toContain("https://bucket.example/x.png");
    expect(said).not.toMatch(/secret/);
  });

  // Between the listing and the removal an item can come to refer to it.
  it("keeps a listed thumbnail an item refers to by the time it would go", async () => {
    const layout = inBucket("s3");
    let reads = 0;
    const referenced = async () =>
      reads++ === 0
        ? refs(layout.referenced)
        : refs(layout.referenced, layout.orphan);

    const { said } = await run(layout, true, referenced);

    expect(said).toContain(`Kept ${layout.orphan}`);
    expect(await layout.stored()).toContain(layout.orphan);
  });

  it("names a thumbnail it could not remove, and ends with an error", async () => {
    const layout = inBucket("s3");
    (layout.storage as Bucket).failOn = layout.orphan;

    const { code, said } = await run(layout, true);

    expect(code).toBe(1);
    expect(said).toContain(`Could not remove ${layout.orphan}`);
  });

  it("says a storage that cannot list its files cannot be searched, and changes nothing", async () => {
    const layout = inBucket("s3");
    const { list: _list, ...unlistable } = layout.storage as Bucket;
    const storage = Object.assign(
      Object.create(Object.getPrototypeOf(layout.storage)),
      unlistable,
      { list: undefined }
    );

    let scans = 0;
    const { code, said } = await run({ ...layout, storage }, true, async () => {
      scans++;
      return refs(layout.referenced);
    });

    expect(code).toBe(1);
    expect(said).toMatch(/cannot list its files/);
    expect(await layout.stored()).toContain(layout.orphan);
    // Known before the media table is read.
    expect(scans).toBe(0);
  });
});

// Media's place is its own when it has a prefix and no other collection on
// the same storage has the same one: then another collection's files are
// never there.
describe("mediaPlaceIsExclusive", () => {
  it.each([
    ["media", [], true],
    ["media/", ["docs"], true],
    // A collection with no prefix stores at the root, and an upload to it
    // can name any folder, media's among them.
    ["media", [""], false],
    ["media", [undefined], false],
    ["", [], false],
    ["media", ["media"], false],
    ["media/", ["media"], false],
    ["media", ["media/"], false],
    // A prefix inside media's, or around it, shares its place too.
    ["uploads", ["uploads/private"], false],
    ["uploads/media", ["uploads"], false],
    ["media", ["media-archive"], true],
    // A prefix and an upload's folder are joined as written, so a prefix
    // that begins media's can name it: `med` with the folder `ia`.
    ["media", ["med"], false],
    ["uploads/media", ["uploads/me"], false],
  ] as const)(
    "prefix %j beside %j is exclusive: %s",
    (prefix, others, expected) => {
      expect(mediaPlaceIsExclusive(prefix, others)).toBe(expected);
    }
  );
});

// What the command treats as in use is what a delete removes for each item,
// read from every page of the media table.
describe("referencedStoredPaths", () => {
  /** A test database holding 501 media items, more than one page. */
  async function mediaTable() {
    const { createTestDb } = await import("../../../__tests__/fixtures/db");
    const db = await createTestDb();
    await db.db.insert(db.schema.users).values({
      id: "user-1",
      email: "user@example.com",
      name: "User",
      passwordHash: "hash",
    });
    const rows = Array.from({ length: 501 }, (_, i) => ({
      id: `media-${i}`,
      // The thumbnail form, as an original a person named so: still in use.
      filename: `2026/10/a${i}-thumb_p.png`,
      originalFilename: "p.png",
      mimeType: "image/png",
      size: 1,
      width: 1,
      height: 1,
      duration: null,
      url: `/uploads/2026/10/a${i}-thumb_p.png`,
      thumbnailUrl: `/uploads/2026/10/b${i}-thumb_p.png`,
      // As the column holds it: JSON text.
      sizes: JSON.stringify({
        small: {
          path: `2026/10/c${i}-thumb_p-small.webp`,
          url: `/uploads/2026/10/c${i}-thumb_p-small.webp`,
        },
      }),
      altText: null,
      caption: null,
      tags: null,
      uploadedBy: "user-1",
      uploadedAt: new Date(),
      updatedAt: new Date(),
    }));
    for (const row of rows)
      await db.db.insert(db.schema.media).values(row as never);

    return db;
  }

  it("names each item's original, upload-time thumbnail and sizes, on every page", async () => {
    const { referencedStoredPaths } = await import("../media");
    const db = await mediaTable();
    const { paths: referenced, unlocated } = await referencedStoredPaths(
      db.adapter as never
    );

    expect(unlocated).toEqual([]);
    expect(referenced.size).toBe(501 * 3);
    for (const i of [0, 500]) {
      expect(referenced).toContain(`2026/10/a${i}-thumb_p.png`);
      expect(referenced).toContain(`2026/10/b${i}-thumb_p.png`);
      expect(referenced).toContain(`2026/10/c${i}-thumb_p-small.webp`);
    }
  });

  it("names a thumbnail whose stored location the record does not show", async () => {
    const { referencedStoredPaths } = await import("../media");
    const db = await mediaTable();
    const elsewhere = "https://thumbs.example.com/m/1/thumb.png";
    await db.db
      .update(db.schema.media)
      .set({ thumbnailUrl: elsewhere })
      .where(eq(db.schema.media.id, "media-7"));

    const { paths, unlocated } = await referencedStoredPaths(
      db.adapter as never
    );

    expect(unlocated).toEqual([elsewhere]);
    expect(paths.size).toBe(501 * 3 - 1);
  });

  // The check before each batch of removals: an item that comes to have a
  // thumbnail no path can match, by a URL under any name, may refer to any
  // listed file, so nothing more is removed.
  it("answers nothing while any item has a thumbnail that cannot be located", async () => {
    const { referencedNowIn } = await import("../media");
    const db = await mediaTable();
    await db.db
      .update(db.schema.media)
      .set({ thumbnailUrl: "https://cdn.example.com/renamed/abc123" })
      .where(eq(db.schema.media.id, "media-3"));

    const now = await referencedNowIn(db.adapter as never)([
      "2026/10/0b7f-thumb_left.png",
    ]);

    expect(now).toBeNull();
  });

  it("names the listed files the media table refers to", async () => {
    const { referencedNowIn } = await import("../media");
    const db = await mediaTable();

    const now = await referencedNowIn(db.adapter as never)([
      "2026/10/b4-thumb_p.png",
      "2026/10/0b7f-thumb_left.png",
    ]);

    expect(now ? [...now] : now).toEqual(["2026/10/b4-thumb_p.png"]);
  });

  // A page read by offset after an item on an earlier page went would start
  // one row late, and skip an item still there; that item's thumbnail would
  // then read as left behind.
  it("names every item still there when one on an earlier page is deleted between pages", async () => {
    const { referencedStoredPaths } = await import("../media");
    const db = await mediaTable();
    const select = db.adapter.select.bind(db.adapter);
    let pages = 0;
    const between = {
      select: async (...args: Parameters<typeof select>) => {
        const rows = await select(...args);
        if (pages++ === 0) {
          await db.db
            .delete(db.schema.media)
            .where(eq(db.schema.media.id, (rows[0] as { id: string }).id));
        }
        return rows;
      },
    };

    const { paths: referenced } = await referencedStoredPaths(between as never);

    const left = await db.db.select().from(db.schema.media);
    expect(left).toHaveLength(500);
    for (const row of left) expect(referenced).toContain(row.filename);
  });
});
