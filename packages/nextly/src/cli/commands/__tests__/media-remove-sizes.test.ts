/**
 * What `nextly media remove-sizes` asks just before it removes size files,
 * over a real media table: the question `nextly media orphans` asks
 * (`referencedNowIn`), with the retired sizes left out.
 *
 * The listing reads the table once, and an upload can commit before the
 * removal that makes a listed file its original. That file must stay. And
 * since every listed file is named by some item's `sizes`, a check that
 * counted them would keep everything, so the size no item uses must go.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  retiredSizesColumnDdl,
  retiredSizesOn,
  runOn,
  setRetiredSizes,
} from "../../../__tests__/helpers/retired-image-sizes";
import { createTestDb } from "../../../__tests__/fixtures/db";
import { removeStoredImageSizes } from "../../../domains/media/retired-image-sizes";
import { sqlRetiredSizesStore } from "../../../domains/media/retired-image-sizes-store";
import { LocalStorageAdapter } from "../../../storage/adapters/local-adapter";
import { referencedNowIn } from "../media";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

/** A media table from before image sizes were removed, on local disk. */
async function setUp() {
  const db = await createTestDb();
  cleanups.push(() => db.close());
  db.sqlite.exec(retiredSizesColumnDdl("sqlite"));
  const folder = await mkdtemp(path.join(tmpdir(), "nextly-sizes-recheck-"));
  cleanups.push(() => rm(folder, { recursive: true, force: true }));
  const storage = new LocalStorageAdapter({
    basePath: folder,
    baseUrl: "/uploads",
  });
  const put = (name: string) =>
    storage.upload(Buffer.from(name), {
      filename: name,
      mimeType: "image/png",
      collection: "media",
    });
  const insert = async (
    id: string,
    original: { path: string; url: string }
  ) => {
    await db.db.insert(db.schema.media).values({
      id,
      filename: original.path,
      originalFilename: path.basename(original.path),
      mimeType: "image/png",
      size: 1,
      url: original.url,
      thumbnailUrl: null,
      uploadedAt: new Date(),
      updatedAt: new Date(),
    } as never);
  };
  const files = async () =>
    (await readdir(folder, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .sort();
  return { db, storage, put, insert, files };
}

describe("remove-sizes asks what items use just before removing", () => {
  it("keeps a size file an upload made its original after the listing, and removes the rest", async () => {
    const { db, storage, put, insert, files } = await setUp();
    const photo = await put("photo.png");
    const small = await put("photo-small.webp");
    const large = await put("photo-large.webp");
    await insert("item-photo", photo);
    await runOn(
      db.db,
      "sqlite",
      setRetiredSizes("item-photo", JSON.stringify({ small, large }))
    );

    // The listing reads every page; then an upload commits whose original
    // is stored under the small size's key, before anything is removed.
    const store = sqlRetiredSizesStore(db.db, "sqlite");
    const listing = store.rows.bind(store);
    store.rows = async function* () {
      yield* listing();
      await insert("item-new-upload", small);
    };

    const { code } = await removeStoredImageSizes({
      store,
      storage,
      objects: { column: true, tableRows: null, keptTable: null },
      apply: true,
      referencedNow: referencedNowIn(db.adapter as never, storage, {
        withRetiredSizes: false,
      }),
      say: () => {},
    });

    expect(code).toBe(0);
    expect(await files()).toEqual(
      [path.basename(photo.path), path.basename(small.path)].sort()
    );
    expect(await retiredSizesOn(db.db, "sqlite", "item-photo")).toBeNull();
  });
});
