/**
 * The Direct API hands back what its types say it does.
 *
 * The generated interfaces describe the WIRE: `routeHandler` formats every REST
 * response, so `createdAt: string` is right for a browser. The Direct API has no
 * such step and returns the row the driver decoded, which is a `Date`. These
 * cases pin the runtime side of that claim on whichever dialect the suite runs
 * against, because a driver deciding otherwise is what would make the type wrong
 * again — and it would fail on one dialect only. Which is why every configured
 * dialect runs these, rather than SQLite standing in for the rest: the defect
 * this fixes was visible on SQLite and invisible on PostgreSQL.
 */
import { afterEach, describe, expect, it } from "vitest";

import { date, defineCollection, text } from "../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const articles = () =>
  defineCollection({
    slug: "articles",
    fields: [text({ name: "title" }), date({ name: "publishedAt" })],
  });

const PUBLISHED_AT = new Date("2026-08-04T09:33:20.000Z");

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({ dialect, collections: [articles()] });
  return current;
}

describe.each(getConfiguredTestDialects())(
  "Direct API row shape (%s)",
  dialect => {
    it("returns Date timestamps from a create", async () => {
      const { nextly } = await boot(dialect);

      const { item } = await nextly.create({
        collection: "articles",
        data: { title: "a", publishedAt: PUBLISHED_AT.toISOString() },
        overrideAccess: true,
      });

      expect(item.createdAt).toBeInstanceOf(Date);
      expect(item.updatedAt).toBeInstanceOf(Date);
      // A user-declared `date` field is stored in a timestamp column too, so it
      // comes back decoded exactly like the built-in ones.
      expect(item.publishedAt).toBeInstanceOf(Date);
    });

    it("returns Date timestamps from a read", async () => {
      const { nextly } = await boot(dialect);
      const { item } = await nextly.create({
        collection: "articles",
        data: { title: "a", publishedAt: PUBLISHED_AT.toISOString() },
        overrideAccess: true,
      });

      const found = await nextly.findByID({
        collection: "articles",
        id: String(item.id),
        overrideAccess: true,
      });

      expect(found?.createdAt).toBeInstanceOf(Date);
      expect(found?.publishedAt).toBeInstanceOf(Date);
      // Asserted on the read as well as the create: a driver that decodes one
      // path and not the other is exactly how the representation came to differ.
      expect(found?.updatedAt).toBeInstanceOf(Date);
    });

    it("returns Date timestamps from a list", async () => {
      const { nextly } = await boot(dialect);
      await nextly.create({
        collection: "articles",
        data: { title: "a", publishedAt: PUBLISHED_AT.toISOString() },
        overrideAccess: true,
      });

      const { items } = await nextly.find({
        collection: "articles",
        overrideAccess: true,
      });

      expect(items).toHaveLength(1);
      expect(items[0]?.createdAt).toBeInstanceOf(Date);
      expect(items[0]?.publishedAt).toBeInstanceOf(Date);
    });

    it("leaves a date field null rather than decoding an absent value", async () => {
      const { nextly } = await boot(dialect);

      const { item } = await nextly.create({
        collection: "articles",
        data: { title: "a" },
        overrideAccess: true,
      });

      // Absent, not the epoch: a decoder applied to a missing value would answer
      // 1970 and every caller reading it would believe the article was published.
      expect(item.publishedAt ?? null).toBeNull();
    });
  }
);
