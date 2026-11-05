/**
 * `contains`, and the search box beside it, ignore case for letters outside ASCII too, and match
 * the same rows on PostgreSQL, MySQL and SQLite.
 *
 * SQLite's own `lower()` folds ASCII letters only, so on SQLite `contains: "CRÈME"` found
 * "CRÈME" but not "crème brûlée", while the other two dialects found both. SQLite connections
 * now carry a Unicode case fold of Nextly's own, which the case-insensitive match uses there.
 *
 * The Turkish capital dotted I is the letter the dialects could disagree on, so it is held here
 * on its own: PostgreSQL (under the libc locale the test database uses) and MySQL lower "İ" to a
 * plain "i", and SQLite's fold is defined to do the same, so "İstanbul" and "istanbul" find each
 * other on all three.
 */
import { afterEach, beforeEach, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

const TITLES = [
  "crème brûlée",
  "CRÈME",
  "Ärger",
  "straße",
  // A capital sigma ending the word: a typed final sigma must meet it.
  "ΟΔΟΣ",
  "İstanbul",
  "istanbul",
  "Spring launch",
];

interface ListHandler {
  listEntries(params: {
    collectionName: string;
    overrideAccess?: boolean;
    search?: string;
  }): Promise<{
    success: boolean;
    data?: { docs: { title?: unknown }[] };
  }>;
}

describeEachDialect(
  "contains ignores case for letters outside ASCII",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: "desserts",
            search: { searchableFields: ["title"] },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      for (const title of TITLES) {
        await current.nextly.create({
          collection: "desserts",
          data: { title },
          overrideAccess: true,
        });
      }
    });

    afterEach(async () => {
      await current.destroy();
    });

    async function titlesWhereContains(value: string): Promise<string[]> {
      const found = await current.nextly.find({
        collection: "desserts",
        where: { title: { contains: value } },
        overrideAccess: true,
      });
      return found.items.map(item => String(item.title)).sort();
    }

    async function titlesSearched(value: string): Promise<string[]> {
      const handler = current.getService(
        "collectionsHandler"
      ) as unknown as ListHandler;
      const listed = await handler.listEntries({
        collectionName: "desserts",
        overrideAccess: true,
        search: value,
      });
      expect(listed.success, JSON.stringify(listed)).toBe(true);
      return (listed.data?.docs ?? []).map(doc => String(doc.title)).sort();
    }

    it("a `contains` filter folds accented capitals", async () => {
      expect(await titlesWhereContains("CRÈME")).toEqual(
        ["CRÈME", "crème brûlée"].sort()
      );
      expect(await titlesWhereContains("crème")).toEqual(
        ["CRÈME", "crème brûlée"].sort()
      );
      expect(await titlesWhereContains("ärger")).toEqual(["Ärger"]);
      // A letter with no capital of its own is matched as it is.
      expect(await titlesWhereContains("STRAßE")).toEqual(["straße"]);
      // The ASCII control: what matched before still matches.
      expect(await titlesWhereContains("SPRING")).toEqual(["Spring launch"]);
    });

    it("a `contains` filter meets a stored capital sigma with a typed final sigma", async () => {
      expect(await titlesWhereContains("οδος")).toEqual(["ΟΔΟΣ"]);
      expect(await titlesWhereContains("ΟΔΟΣ")).toEqual(["ΟΔΟΣ"]);
    });

    it("a `contains` filter matches the dotted capital İ as a plain i, as every dialect lowers it", async () => {
      expect(await titlesWhereContains("istanbul")).toEqual(
        ["istanbul", "İstanbul"].sort()
      );
      expect(await titlesWhereContains("İSTANBUL")).toEqual(
        ["istanbul", "İstanbul"].sort()
      );
    });

    it("the search box folds accented capitals", async () => {
      expect(await titlesSearched("CRÈME")).toEqual(
        ["CRÈME", "crème brûlée"].sort()
      );
      expect(await titlesSearched("ÄRGER")).toEqual(["Ärger"]);
    });
  }
);
