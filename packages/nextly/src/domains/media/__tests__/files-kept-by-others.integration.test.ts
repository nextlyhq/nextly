/**
 * The search for files another media item refers to, on each dialect it
 * runs on: it reads `sizes` as text, which PostgreSQL and MySQL store as
 * JSON and cannot match with `like` as it is, so SQLite alone proves nothing.
 *
 * `sizes` is the retired column a database from before image sizes were
 * removed still has, which no definition names: it is added here as such a
 * database has it, and read through the reader every delete uses.
 */
import { afterAll, beforeAll, expect, it } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  retiredSizesColumnDdl,
  runOn,
  setRetiredSizes,
} from "../../../__tests__/helpers/retired-image-sizes";
import { consoleLogger } from "../../../shared/types";
import { filesKeptByOthers } from "../remove-stored-files";
import { StoredFileSearchReader } from "../stored-file-search";

const SHARED = "2026/10/3b1c-photo-small.webp";
// A key may hold what JSON escapes and `like` reads as its own escape.
const ESCAPED = '2026/10/5c5c-a\\b"c-small.webp';
const ALONE = "2026/10/7e2d-photo-medium.webp";

describeEachDialect("files another item refers to", dialect => {
  let current: TestNextly;

  beforeAll(async () => {
    current = await createTestNextly({ dialect });
    await current.adapter.executeQuery(retiredSizesColumnDdl(dialect));
    await current.adapter.insert("users", {
      id: "owner-1",
      email: "owner-1@test.local",
    });
    // The other item shares one size with the deleted one, only through its
    // own sizes.
    await current.adapter.insert("media", {
      id: "other-1",
      filename: "2026/10/9a9a-other.png",
      originalFilename: "other.png",
      mimeType: "image/png",
      size: 1,
      url: "/uploads/2026/10/9a9a-other.png",
      uploadedBy: "owner-1",
      uploadedAt: new Date(),
      updatedAt: new Date(),
    });
    await runOn(
      current.adapter.getDrizzle(),
      dialect,
      setRetiredSizes(
        "other-1",
        JSON.stringify({
          small: { path: SHARED, url: `/uploads/${SHARED}` },
          tiny: { path: ESCAPED, url: `/uploads/${ESCAPED}` },
        })
      )
    );
  });

  afterAll(async () => {
    await current.destroy();
  });

  it("finds a size whose key holds a backslash or a quote", async () => {
    const probe = new StoredFileSearchReader(current.adapter, consoleLogger);

    const kept = await filesKeptByOthers(
      probe.search,
      [ESCAPED],
      ["deleted-1"]
    );

    expect([...(kept ?? [])]).toEqual([ESCAPED]);
  });

  it("finds a size another item holds in its sizes, and nothing else", async () => {
    const probe = new StoredFileSearchReader(current.adapter, consoleLogger);

    const kept = await filesKeptByOthers(
      probe.search,
      [SHARED, ALONE],
      ["deleted-1"]
    );

    // Not null: the statement ran on this dialect.
    expect(kept).not.toBeNull();
    expect([...(kept ?? [])]).toEqual([SHARED]);
  });
});
