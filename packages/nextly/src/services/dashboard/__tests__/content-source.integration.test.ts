/**
 * `system:content` against a real database: each collection the reader may see
 * on the dashboard, with its entries and how many are drafts, counted the way
 * `/stats` counts them, and a collection hidden from the navigation left out.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { executeWidgetQuery } from "../../../domains/widgets/execute";
import { CONTENT_SOURCE_ID } from "../../../domains/widgets/system-source-ids";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run on a reused database.
const ARTICLES = "cs_articles";
const TAGS = "cs_tags";
const HIDDEN = "cs_hidden";
const READER = { id: "cs-reader", name: "Reader", email: "reader@cs.test" };

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      // Draft/Published, so its entries split.
      defineCollection({
        slug: ARTICLES,
        status: true,
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
      // No lifecycle: every entry counts as published.
      defineCollection({
        slug: TAGS,
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: HIDDEN,
        admin: { hidden: true },
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  await current.adapter.insert("users", { ...READER, is_active: true });
  return current;
}

describe.each(getConfiguredTestDialects())(
  "the Content card's source (integration, %s)",
  dialect => {
    it("answers each collection's entries and drafts as the reader, and leaves a hidden one out", async () => {
      const t = await boot(dialect);
      for (const status of ["published", "draft", "draft"]) {
        await t.nextly.create({
          collection: ARTICLES as never,
          data: { title: status, status } as never,
        });
      }
      await t.nextly.create({
        collection: TAGS as never,
        data: { title: "tag" } as never,
      });
      await t.nextly.create({
        collection: HIDDEN as never,
        data: { title: "hidden" } as never,
      });

      const answer = (await executeWidgetQuery(
        { source: CONTENT_SOURCE_ID, op: "list" },
        { user: { id: READER.id, roles: [] } }
      )) as { items: Record<string, unknown>[] };
      const bySlug = new Map(answer.items.map(row => [row.slug, row]));

      expect(bySlug.get(ARTICLES)).toMatchObject({
        count: 3,
        published: 1,
        draft: 2,
      });
      expect(bySlug.get(TAGS)).toMatchObject({
        count: 1,
        published: 1,
        draft: 0,
      });
      // Kept off the dashboard for every reader, though readable to this one.
      expect(bySlug.has(HIDDEN)).toBe(false);
    });
  }
);
