/**
 * How many lock rows a save takes in the SEO plugin's address record. A
 * save holds the lock row of its page and of every path at or above each of
 * its addresses, and core asks the record once for each address and then
 * once to record it: each row is taken once per save, not once per call.
 * SQLite runs one writer at a time and takes none.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { statementsOf } from "../../__tests__/count-statements";
import { seoPlugin } from "../../plugin";
import { lastCatchUp } from "../catch-up";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A statement taking a lock row: one update adding to its `taken`. */
const takesLock = (sql: string) =>
  /^\s*update\b/i.test(sql) && /seo__addresses/.test(sql) && /taken/.test(sql);

/**
 * Wait for the page heads a committed change expires to be expired: the
 * expiry follows the commit, so it is counted with the save that made it.
 */
const settled = () => new Promise(resolve => setTimeout(resolve, 100));

describe.each(getConfiguredTestDialects())(
  "the lock rows a save takes in the address record (%s)",
  dialect => {
    it("takes each once a save: four for a post at /blog/x, eight for a slug change and its redirect", async () => {
      const t: TestNextly = await createTestNextly({
        dialect,
        plugins: [seoPlugin({ collections: ["posts"] })],
        collections: [
          defineCollection({
            slug: "posts",
            status: true,
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/blog/{slug}",
          }),
        ],
      });
      current = t;
      await lastCatchUp();
      // The lock rows of "/" and "/blog" made once, as the site's first post
      // made them.
      await t.nextly.create({
        collection: "posts",
        data: { title: "First", slug: "first", status: "published" },
      });
      await settled();

      const locksOf = async (work: () => Promise<unknown>) =>
        (
          await statementsOf(dialect, async () => {
            await work();
            await settled();
          })
        ).filter(takesLock).length;

      let id = "";
      const created = await locksOf(async () => {
        const made = await t.nextly.create({
          collection: "posts",
          data: { title: "One", slug: "one", status: "published" },
        });
        id = String(made.item.id);
      });
      const kept = await locksOf(() =>
        t.nextly.update({
          collection: "posts",
          id,
          data: { title: "One again", _overwrite: true },
        })
      );
      // The save's own question, then the redirect's from the old address.
      const moved = await locksOf(() =>
        t.nextly.update({
          collection: "posts",
          id,
          data: { slug: "one-moved", _overwrite: true },
        })
      );

      // The page's own row, then "/", "/blog" and "/blog/one".
      const each = dialect === "sqlite" ? 0 : 4;
      expect({ created, kept, moved }).toEqual({
        created: each,
        kept: each,
        moved: each * 2,
      });
    });
  }
);
