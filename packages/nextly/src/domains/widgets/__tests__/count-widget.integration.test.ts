/**
 * The Count card's reads, against a real database: its declaration's `load`,
 * set to a collection, run as a reader with one frozen instant.
 *
 * What only a database can settle:
 * - the number is the same read either way: a lifecycle collection's status
 *   split sums to the plain count;
 * - the trend, a series over the last 30 days, and the period before it, a
 *   count over the window as long that ends where the series starts, are
 *   adjacent, so an entry is in one of them at most;
 * - the chart's bars sum to the figure a count over the same window gives.
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
import { executeWidgetQuery } from "../execute";
import { validateWidgetQuery } from "../query";

import { loadCard, servicesFor } from "./core-card-load";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const POSTS = "cnt_posts";
const NOTES = "cnt_notes";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The batch's one instant, mid-morning so no row sits on today's midnight. */
const NOW = new Date("2026-06-15T10:00:00.000Z");
/** The start of NOW's UTC day, where the series' last day starts. */
const TODAY = new Date("2026-06-15T00:00:00.000Z");
/** The first instant of the last 30 days: the series' window, from the instant 30 days back. */
const RECENT_START = new Date(NOW.getTime() - 30 * DAY_MS);
/** The UTC day the series' first, partial, point starts. */
const FIRST_DAY = new Date("2026-05-16T00:00:00.000Z");
/** The first instant of the 30 days before them: the window as long, ending where they start. */
const PRIOR_START = new Date(NOW.getTime() - 60 * DAY_MS);

/** A reader the gate finds holding super-admin, seeded at each boot. */
const admin: ReadCaller = { user: { id: "admin" } };

/** One post: its status, and the instant its row says it was created. */
interface Row {
  status: "published" | "draft";
  createdAt: Date;
}

/**
 * Posts placed on each side of both boundaries, in each status. Each is named
 * by where it must be counted.
 */
const POST_ROWS: Record<string, Row> = {
  // The first instant of the recent period: in the trend, not the prior.
  recentFirst: { status: "published", createdAt: RECENT_START },
  // A second before it, in the prior period. A second, not a millisecond:
  // a dialect storing whole seconds would round a millisecond onto the line.
  priorLast: {
    status: "draft",
    createdAt: new Date(RECENT_START.getTime() - 1000),
  },
  // Today, before the batch's instant.
  today: { status: "published", createdAt: new Date(NOW.getTime() - 60_000) },
  // Two days back, a draft: in the trend.
  recentDraft: {
    status: "draft",
    createdAt: new Date(TODAY.getTime() - 2 * DAY_MS),
  },
  // The first instant of the prior period: in it.
  priorFirst: { status: "draft", createdAt: PRIOR_START },
  // A second before it: in neither period, still in the total.
  older: {
    status: "published",
    createdAt: new Date(PRIOR_START.getTime() - 1000),
  },
};

/** What a Count card set to `collection` answers, at `tier`, at the batch's instant. */
function count(
  collection: string,
  tier: "small" | "medium" | "large"
): Promise<CountWidgetData> {
  return loadCard(countWidget, { collection }, admin, {
    size: { w: 8, h: 3, tier },
    now: NOW,
  });
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
      const card = await count(POSTS, "medium");
      expect(card.split).toEqual({ published: 3, draft: 3 });
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

    it("counts a collection without a lifecycle plainly", async () => {
      await boot();
      expect(await count(NOTES, "medium")).toEqual({ total: 2 });
    });

    it("puts each entry in one of the trend and the period before it at most, the two windows adjacent", async () => {
      await boot();
      const trend = (await count(POSTS, "large")).trend;
      if (trend === undefined) throw new Error("a large card draws its trend");
      // A bar for each of the 31 UTC days the window overlaps, the first of
      // them partial, and the last being today.
      expect(trend.points).toHaveLength(31);
      expect(new Date(trend.points[0].start).getTime()).toBe(
        FIRST_DAY.getTime()
      );
      expect(new Date(trend.points[30].start).getTime()).toBe(TODAY.getTime());
      // recentFirst, recentDraft and today; not priorLast, a second earlier,
      // on the same first day.
      expect(trend.points[0].count).toBe(1);
      expect(trend.points.reduce((sum, p) => sum + p.count, 0)).toBe(3);

      // priorFirst and priorLast; not recentFirst, nor older a second before
      // the period opens.
      expect(trend.prior).toBe(2);
    });

    it("draws bars that sum to the recent figure a count over the same window gives", async () => {
      await boot();
      const trend = (await count(POSTS, "large")).trend;
      if (trend === undefined) throw new Error("a large card draws its trend");
      const recent = await servicesFor(admin, NOW).count(POSTS, {
        status: "all",
        window: { range: "30d" },
      });
      expect(recent).toBe(trend.points.reduce((sum, p) => sum + p.count, 0));
    });

    it("reads no trend for a card narrower than large", async () => {
      await boot();
      expect((await count(POSTS, "medium")).trend).toBeUndefined();
    });
  }
);
