/**
 * The Count card's reads, against a real database: its declaration's `load`,
 * set to a collection, run as a reader with one frozen instant.
 *
 * What only a database can settle:
 * - the number is the same read either way: a lifecycle collection's status
 *   split sums to the plain count;
 * - every line under the number counts what the number counts: the change this
 *   week and the trend count only the entries its Count setting counts, so a
 *   week of new published entries is no change to the drafts;
 * - the trend ends at the number, each week before it taking off what was made
 *   after it.
 *
 * Rows are backdated on the stored row, since a write stamps its own instant.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { refreshContentSources } from "../content-sources";
import { countWidget } from "../core-widgets/count";
import type { CountWidgetData } from "../core-widgets/data";
import type { WidgetLoadSize } from "../declaration/define-widget";
import { executeWidgetQuery } from "../execute";
import { validateWidgetQuery } from "../query";

import { loadCard } from "./core-card-load";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const POSTS = "cnt_posts";
const NOTES = "cnt_notes";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The batch's one instant: a Monday mid-morning, so this week began today. */
const NOW = new Date("2026-06-15T10:00:00.000Z");

/** `days` before the batch's instant. */
const daysBack = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

/** A reader the gate finds holding super-admin, seeded at each boot. */
const admin: ReadCaller = { user: { id: "admin" } };

/** One post: its status, and the instant its row says it was created. */
interface Row {
  status: "published" | "draft";
  createdAt: Date;
}

/**
 * Posts each named by when they were made. Every post of the last 7 days is
 * published; the drafts are older.
 */
const POST_ROWS: Record<string, Row> = {
  // This week: today, before the batch's instant.
  today: { status: "published", createdAt: new Date(NOW.getTime() - 60_000) },
  // Last week, and in the last 7 days.
  saturday: { status: "published", createdAt: daysBack(2) },
  friday: { status: "published", createdAt: daysBack(3) },
  // Older than 7 days.
  tenDays: { status: "draft", createdAt: daysBack(10) },
  twentyDays: { status: "published", createdAt: daysBack(20) },
  fortyDays: { status: "draft", createdAt: daysBack(40) },
  // Before the 8 weeks a trend draws.
  longAgo: { status: "published", createdAt: daysBack(200) },
};

/** Small and wide: a quarter and two thirds of the dashboard. */
const SMALL: WidgetLoadSize = { w: 3, h: 2, tier: "small" };
const WIDE: WidgetLoadSize = { w: 8, h: 3, tier: "large" };

/** What a Count card holding `stored` answers, at the batch's instant. */
function count(
  stored: Record<string, unknown>,
  size: WidgetLoadSize = SMALL
): Promise<CountWidgetData> {
  return loadCard(countWidget, stored, admin, { size, now: NOW });
}

describe.each(getConfiguredTestDialects())(
  "the Count card's reads (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<void> {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: POSTS,
            status: true,
            fields: [text({ name: "title" })],
          }),
          defineCollection({ slug: NOTES, fields: [text({ name: "title" })] }),
        ],
      });
      const t = current;
      await superAdminUser(t, "admin");
      const handler = t.getService("collectionsHandler") as unknown as {
        createEntry: (
          p: Record<string, unknown>,
          data: Record<string, unknown>
        ) => Promise<{ data?: { id?: string } | null }>;
      };
      for (const [title, row] of Object.entries(POST_ROWS)) {
        const created = await handler.createEntry(
          { collectionName: POSTS, overrideAccess: true },
          { title, status: row.status }
        );
        const id = created.data?.id;
        if (typeof id !== "string") throw new Error(`no id for ${title}`);
        await t.adapter.update(
          `dc_${POSTS}`,
          { created_at: row.createdAt },
          { and: [{ column: "id", op: "=", value: id }] }
        );
      }
      for (const title of ["a", "b"]) {
        await handler.createEntry(
          { collectionName: NOTES, overrideAccess: true },
          { title }
        );
      }
      // A dashboard request rebuilds the content sources before it resolves a
      // card, and boot publishes none; the executor is called directly here.
      await refreshContentSources();
    }

    it("states one number whichever read gives it: the split's buckets sum to the count", async () => {
      await boot();
      const card = await count({ collection: POSTS, show: "split" });
      expect(card.line).toBe("split");
      expect(card.split).toMatchObject({ published: 5, draft: 2 });
      const plain = await executeWidgetQuery(
        validateWidgetQuery({
          source: `collection:${POSTS}`,
          op: "count",
          status: "all",
        }),
        admin,
        { now: NOW }
      );
      expect(plain).toEqual({ op: "count", total: card.total });
      expect(card.total).toBe(Object.keys(POST_ROWS).length);
    });

    it("counts the change this week from the set the number counts", async () => {
      await boot();
      expect(await count({ collection: POSTS })).toEqual({
        total: 7,
        counted: "all",
        line: "change",
        change: 3,
      });
      expect(await count({ collection: POSTS, count: "published" })).toEqual({
        total: 5,
        counted: "published",
        line: "change",
        change: 3,
      });
    });

    it("draws no change for the drafts when the week's new entries are all published", async () => {
      // 🔴 Counted from every entry, the drafts' line would say "+3 this week"
      // under a number that did not move.
      await boot();
      expect(await count({ collection: POSTS, count: "draft" })).toEqual({
        total: 2,
        counted: "draft",
        line: "change",
        change: 0,
      });
    });

    it("ends the trend at the number, each week before it without what was made after it", async () => {
      await boot();
      const all = await count({ collection: POSTS, show: "trend" });
      // From the end of the week 8 weeks back, then now. Monday 15 June began
      // this week: today's post; the week before held Saturday's and Friday's,
      // and each earlier post its own week.
      expect(all.trend).toEqual([1, 1, 2, 2, 2, 3, 4, 6, 7]);
      expect(all.trend?.at(-1)).toBe(all.total);
      const drafts = await count({
        collection: POSTS,
        count: "draft",
        show: "trend",
      });
      expect(drafts.trend).toEqual([0, 0, 1, 1, 1, 1, 2, 2, 2]);
    });

    it("counts a collection without a lifecycle plainly, even asked for a split", async () => {
      await boot();
      expect(await count({ collection: NOTES, show: "split" })).toMatchObject({
        total: 2,
        counted: "all",
        line: "change",
      });
    });

    it("answers the same at a quarter and at two thirds of the dashboard", async () => {
      await boot();
      expect(await count({ collection: POSTS }, WIDE)).toEqual(
        await count({ collection: POSTS }, SMALL)
      );
    });
  }
);
