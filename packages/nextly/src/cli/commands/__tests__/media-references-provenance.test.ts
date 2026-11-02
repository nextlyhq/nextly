/**
 * How often the reads of what media items refer to ask whether the media
 * table's `sizes` column is the one image sizes were stored in.
 *
 * That question is two metadata reads, the catalogue's column types and the
 * owner registry, and its answer does not change during a scan. A scan reads
 * the media table 500 rows a page, and `nextly media orphans` scans it again
 * before every batch of 50 files it removes, so asking per page multiplies
 * those reads by pages times batches. Asked once and reused, the answer must
 * still reach every page: a size named only on the last page is counted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  retiredSizesColumnDdl,
  runOn,
  setRetiredSizes,
} from "../../../__tests__/helpers/retired-image-sizes";
import { createTestDb } from "../../../__tests__/fixtures/db";
import { retiredSizesReader } from "../../../domains/media/retired-image-sizes-store";
import { SchemaOwnersRepository } from "../../../domains/schema/ownership/schema-owners-repository";
import { referencedNowIn, referencedStoredPaths } from "../media";

/** The catalogue reads, counted, each passed through to the real one. */
const catalogue = vi.hoisted(() => ({ reads: 0 }));
vi.mock(
  "../../../domains/schema/pipeline/live-column-types",
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import("../../../domains/schema/pipeline/live-column-types")
      >();
    return {
      ...actual,
      queryLiveColumnTypes: (
        ...args: Parameters<typeof actual.queryLiveColumnTypes>
      ) => {
        catalogue.reads += 1;
        return actual.queryLiveColumnTypes(...args);
      },
    };
  }
);

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanups.length > 0) await cleanups.pop()?.();
});

let ownerReads: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  ownerReads = vi.spyOn(SchemaOwnersRepository.prototype, "read");
});

/** Rows enough for three pages, and the retired column on the media table. */
async function libraryOfThreePages() {
  const db = await createTestDb();
  cleanups.push(() => db.close());
  db.sqlite.exec(retiredSizesColumnDdl("sqlite"));
  const ids: string[] = [];
  for (let start = 0; start < 1201; start += 200) {
    const rows = [];
    for (let i = start; i < Math.min(start + 200, 1201); i++) {
      const id = `item-${String(i).padStart(5, "0")}`;
      ids.push(id);
      rows.push({
        id,
        filename: `2026/10/${id}.png`,
        originalFilename: `${id}.png`,
        mimeType: "image/png",
        size: 1,
        url: `/uploads/2026/10/${id}.png`,
        thumbnailUrl: null,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await db.db.insert(db.schema.media).values(rows as never);
  }
  // A size named only by the last item, on the third page.
  await runOn(
    db.db,
    "sqlite",
    setRetiredSizes(
      ids[ids.length - 1],
      JSON.stringify({ small: { path: "2026/10/last-small.webp" } })
    )
  );
  catalogue.reads = 0;
  ownerReads.mockClear();
  return db;
}

describe("the retired column's provenance, asked once per scan", () => {
  it("is asked once for a scan of three pages, which still reads every page's sizes", async () => {
    const db = await libraryOfThreePages();

    const references = await referencedStoredPaths(db.adapter as never);

    expect(references.paths).toContain("2026/10/last-small.webp");
    expect(references.paths).toContain("2026/10/item-00000.png");
    expect(catalogue.reads).toBe(1);
    expect(ownerReads).toHaveBeenCalledTimes(1);
  });

  it("is asked once across every recheck a removal makes", async () => {
    const db = await libraryOfThreePages();
    const referencedNow = referencedNowIn(db.adapter as never, {
      getType: () => "local",
    });

    const answers = [];
    for (const batch of [
      ["2026/10/last-small.webp"],
      ["2026/10/item-00000.png", "2026/10/nobody.png"],
      ["2026/10/nobody-else.png"],
    ]) {
      answers.push(await referencedNow(batch));
    }

    expect(answers.map(answer => [...(answer ?? [])])).toEqual([
      ["2026/10/last-small.webp"],
      ["2026/10/item-00000.png"],
      [],
    ]);
    expect(catalogue.reads).toBe(1);
    expect(ownerReads).toHaveBeenCalledTimes(1);
  });
});

describe("a reader whose column is dropped after its provenance was asked", () => {
  // As `nextly media remove-sizes --apply --drop` can, between a folder
  // delete's chunks or between a delete's check and its read. The drop runs
  // only once no item names a size file, so reading none loses nothing,
  // while failing would abort the delete.
  it("reads no sizes rather than failing", async () => {
    const db = await libraryOfThreePages();
    const reader = retiredSizesReader(db.db, "sqlite");
    const last = "item-01200";
    expect((await reader([last])).get(last)).toBeDefined();

    db.sqlite.exec('ALTER TABLE "media" DROP COLUMN "sizes"');

    await expect(reader([last])).resolves.toEqual(new Map());
    // Remembered: the next read does not name the column again.
    await expect(reader(["item-00000"])).resolves.toEqual(new Map());
  });

  it("still fails for any other failure (the control)", async () => {
    const db = await libraryOfThreePages();
    const reader = retiredSizesReader(db.db, "sqlite");
    await reader(["item-00000"]);

    db.sqlite.exec('ALTER TABLE "media" RENAME TO "media_gone"');

    await expect(reader(["item-00000"])).rejects.toThrow();
  });
});
