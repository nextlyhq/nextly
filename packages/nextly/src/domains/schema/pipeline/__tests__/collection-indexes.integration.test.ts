/**
 * A collection's declared compound unique index exists, and is enforced, on
 * every dialect.
 *
 * Boot creates a code-first collection's missing table through the push
 * pipeline, and built the desired entry without the collection's `indexes`:
 * the table came up with no declared index, so the uniqueness it promised was
 * never enforced. Asked of the database, through a real Nextly per dialect,
 * and judged by behaviour as well as by the catalog: a unique index that
 * exists without its uniqueness reads fine and refuses nothing.
 */
import { afterEach, expect, it } from "vitest";

import { defineCollection, text } from "../../../../config";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { indexNameForColumns } from "../../services/index-name";
import { introspectLiveSnapshot } from "../diff/introspect-live";

const TABLE = "dc_places";
const DECLARED = indexNameForColumns(TABLE, ["country", "city"], true);

const places = defineCollection({
  slug: "places",
  fields: [
    text({ name: "title" }),
    text({ name: "country" }),
    text({ name: "city" }),
  ],
  indexes: [{ fields: ["country", "city"], unique: true }],
});

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describeEachDialect(
  "a collection's declared unique compound index",
  dialect => {
    function create(title: string, country: string, city: string) {
      return current!.nextly.create({
        collection: "places",
        data: { title, country, city },
        overrideAccess: true,
      });
    }

    it("is created with the table at boot", async () => {
      current = await createTestNextly({ dialect, collections: [places] });

      // Read as the diff reads it, so a later push compares against this.
      const live = await introspectLiveSnapshot(
        current.adapter.getDrizzle(),
        dialect,
        [TABLE]
      );
      const index = live.tables[0]?.indexes?.find(i => i.name === DECLARED);
      expect(index).toMatchObject({
        columns: ["country", "city"],
        unique: true,
      });
    });

    it("refuses a second entry with the same pair", async () => {
      current = await createTestNextly({ dialect, collections: [places] });

      await create("First", "PK", "Lahore");
      // Controls: the key is the PAIR. A unique index on either column alone
      // would refuse one of these, and a create that fails for any other
      // reason would fail here first.
      await create("Second", "PK", "Karachi");
      await create("Third", "IN", "Lahore");

      await expect(create("Fourth", "PK", "Lahore")).rejects.toThrow();
    });
  }
);
