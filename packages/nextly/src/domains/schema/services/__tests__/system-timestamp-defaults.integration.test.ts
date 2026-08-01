/**
 * `created_at` and `updated_at` get their value from the database, on every dialect.
 *
 * Nextly's own write path sets both, so nothing reaching the database through the API depends on
 * this. What does depend on it is everything that does NOT go through that path: a direct insert, a
 * data import, a migration backfilling rows. On PostgreSQL and MySQL those got a time; on SQLite
 * the column had no default and they got NULL, and a NULL timestamp is indistinguishable from the
 * "never set" the reader treats as missing.
 *
 * Asserted through a real insert rather than by reading the descriptor back: the descriptor is one
 * of three descriptions of this column set, and agreeing with itself is what it already did while
 * the physical table disagreed.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe.each(getConfiguredTestDialects())(
  "system timestamp defaults (%s)",
  dialect => {
    it("fills both timestamps for an insert that omits them", async () => {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "posts",
            fields: [text({ name: "title" })],
          }),
        ],
      });

      // Straight at the table, carrying only the columns a caller must supply. Going through
      // `createEntry` would stamp both itself and prove nothing about the column.
      await current.adapter.insert("dc_posts", {
        id: "row-1",
        title: "t",
        slug: "t",
      });

      const rows =
        await current.adapter.select<Record<string, unknown>>("dc_posts");
      const row = rows.find(r => r.id === "row-1") ?? {};

      expect(row.created_at).toBeTruthy();
      expect(row.updated_at).toBeTruthy();
    });
  }
);
