/**
 * A media delete while `nextly media remove-sizes --apply --drop` drops the
 * retired `sizes` column, on every dialect: the delete asks whether the
 * column is the retired one, the drop runs, and the delete's read of the
 * item's stored sizes then names a column that is gone. The drop runs only
 * once no item names a size file, so the delete has none to read: it must
 * finish, the row gone and its original and thumbnail removed, rather than
 * fail half-way.
 *
 * The drop is made to land exactly there by running it inside the
 * catalogue read that answers whether the column is there, after the
 * answer is taken.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { retiredSizesColumnDdl } from "../../../__tests__/helpers/retired-image-sizes";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { PNG_1X1 } from "../../../services/upload-validation/__tests__/format-fixtures";
import { getMediaStorage } from "../../../storage/storage";
import { storedFilesOf } from "../stored-files";

/** Run once, after the next catalogue read of the media table answers. */
const race = vi.hoisted(() => ({
  afterMediaRead: undefined as undefined | (() => Promise<void>),
  ran: false,
}));
vi.mock("../../schema/pipeline/live-column-types", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("../../schema/pipeline/live-column-types")
    >();
  return {
    ...actual,
    queryLiveColumnTypes: async (
      ...args: Parameters<typeof actual.queryLiveColumnTypes>
    ) => {
      const answer = await actual.queryLiveColumnTypes(...args);
      const hook = race.afterMediaRead;
      if (hook && args[2].includes("media")) {
        race.afterMediaRead = undefined;
        await hook();
        race.ran = true;
      }
      return answer;
    },
  };
});

describeEachDialect("a media delete while sizes is dropped", dialect => {
  let t: TestNextly;

  beforeAll(async () => {
    t = await createTestNextly({ dialect });
  });

  afterAll(async () => {
    await t?.destroy();
  });

  it("finishes, removing the row, the original and the thumbnail", async () => {
    const q = dialect === "mysql" ? "`" : '"';
    await t.adapter.executeQuery(retiredSizesColumnDdl(dialect));
    const uploaded = await t.nextly.media.upload({
      file: {
        data: PNG_1X1,
        name: "photo.png",
        mimetype: "image/png",
        size: PNG_1X1.length,
      },
    });
    const [row] = await t.adapter.select<{
      filename: string;
      url: string;
      thumbnailUrl: string | null;
    }>("media", {
      where: { and: [{ column: "id", op: "=", value: uploaded.id }] },
    });
    const files = storedFilesOf(row).paths;
    // The original and the thumbnail an upload stores, both there.
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(await getMediaStorage().exists(file, "media")).toBe(true);
    }
    race.ran = false;
    race.afterMediaRead = async () => {
      await t.adapter.executeQuery(
        `ALTER TABLE ${q}media${q} DROP COLUMN ${q}sizes${q}`
      );
    };

    await t.getService("mediaService").delete(uploaded.id, {});

    // The drop landed inside the delete, after its check.
    expect(race.ran).toBe(true);
    const left = await t.adapter.select("media", {
      where: { and: [{ column: "id", op: "=", value: uploaded.id }] },
    });
    expect(left).toEqual([]);
    for (const file of files) {
      expect(await getMediaStorage().exists(file, "media")).toBe(false);
    }
  });
});
