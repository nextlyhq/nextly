/**
 * The search for files another media item refers to, on each dialect it
 * runs on: it reads `sizes` as text, which PostgreSQL and MySQL store as
 * JSON and cannot match with `like` as it is, so SQLite alone proves nothing.
 */
import { afterAll, beforeAll, expect, it } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { BaseService } from "../../../shared/base-service";
import { consoleLogger } from "../../../shared/types";
import {
  filesKeptByOthers,
  type StoredFileSearch,
} from "../remove-stored-files";

/** The search as the media services build it, over this instance's table. */
class SearchProbe extends BaseService {
  search(): StoredFileSearch {
    const { media } = this.tables;
    return {
      columns: media,
      dialect: this.dialect,
      read: where =>
        this.db
          .select({
            filename: media.filename,
            url: media.url,
            thumbnailUrl: media.thumbnailUrl,
            sizes: media.sizes,
          })
          .from(media)
          .where(where),
    };
  }
}

const SHARED = "2026/10/3b1c-photo-small.webp";
const ALONE = "2026/10/7e2d-photo-medium.webp";

/** `sizes` as the column takes it: JSON on PostgreSQL and MySQL, text on SQLite. */
function sizesFor(dialect: TestDialect, sizes: object): unknown {
  return dialect === "sqlite" ? JSON.stringify(sizes) : sizes;
}

describeEachDialect("files another item refers to", dialect => {
  let current: TestNextly;

  beforeAll(async () => {
    current = await createTestNextly({ dialect });
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
      sizes: sizesFor(dialect, {
        small: { path: SHARED, url: `/uploads/${SHARED}` },
      }),
      uploadedBy: "owner-1",
      uploadedAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await current.destroy();
  });

  it("finds a size another item holds in its sizes, and nothing else", async () => {
    const probe = new SearchProbe(current.adapter, consoleLogger);

    const kept = await filesKeptByOthers(
      probe.search(),
      [SHARED, ALONE],
      ["deleted-1"]
    );

    // Not null: the statement ran on this dialect.
    expect(kept).not.toBeNull();
    expect([...(kept ?? [])]).toEqual([SHARED]);
  });
});
