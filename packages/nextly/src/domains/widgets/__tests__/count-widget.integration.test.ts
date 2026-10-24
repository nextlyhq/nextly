/**
 * The Count card's reads, against a real database: each cell as core declares
 * it, set to a collection, run through the executor with one frozen instant.
 *
 * What only a database can settle:
 * - the number is the same read either way: a lifecycle collection's status
 *   split sums to the plain count;
 * - the trend and the period before it are adjacent and whole, on the UTC
 *   days the chart's bars are drawn on, so an entry is in exactly one of them;
 * - the chart's bars sum to the figure the card states for them.
 *
 * Rows are backdated on the stored row, since a write stamps its own instant.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { refreshContentSources } from "../collection-widgets";
import { CORE_WIDGETS } from "../core-widgets";
import { executeWidgetQuery } from "../execute";
import { validateWidgetQuery } from "../query";
import type { WidgetResult } from "../result";

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
/** The start of NOW's UTC day, where the day buckets and the spans step from. */
const TODAY = new Date("2026-06-15T00:00:00.000Z");
/** The first instant of the last 30 days, today included. */
const RECENT_START = new Date(TODAY.getTime() - 29 * DAY_MS);
/** The first instant of the 30 days before them. */
const PRIOR_START = new Date(TODAY.getTime() - 59 * DAY_MS);

const admin: ReadCaller = { user: { id: "admin", roles: ["super-admin"] } };

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

const COUNT = CORE_WIDGETS.find(widget => widget.id === "core/count");

/** One of Count's cells, as core declares it, set to `collection`. */
function cellQuery(key: string, collection: string) {
  const cell = (COUNT?.cells ?? []).find(
    candidate => "query" in candidate && candidate.key === key
  );
  if (cell === undefined || !("query" in cell)) {
    throw new Error(`core/count has no cell "${key}"`);
  }
  return validateWidgetQuery({
    ...cell.query,
    source: `collection:${collection}`,
  });
}

async function run(key: string, collection: string): Promise<WidgetResult> {
  return executeWidgetQuery(cellQuery(key, collection), admin, { now: NOW });
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
      const split = await run("split", POSTS);
      if (split.op !== "groupBy") throw new Error(split.op);
      const byStatus = Object.fromEntries(
        split.buckets.map(bucket => [String(bucket.value), bucket.count])
      );
      expect(byStatus).toEqual({ published: 3, draft: 3 });

      const summed = split.buckets.reduce((sum, b) => sum + b.count, 0);
      const plain = await executeWidgetQuery(
        validateWidgetQuery({
          source: `collection:${POSTS}`,
          op: "count",
          status: "all",
        }),
        admin,
        { now: NOW }
      );
      expect(plain).toEqual({ op: "count", total: summed });
      expect(summed).toBe(Object.keys(POST_ROWS).length);
    });

    it("counts a collection without a lifecycle plainly", async () => {
      await boot();
      expect(await run("total", NOTES)).toEqual({ op: "count", total: 2 });
    });

    it("puts each entry in exactly one of the trend and the period before it, on whole UTC days", async () => {
      await boot();
      const trend = await run("trend", POSTS);
      if (trend.op !== "timeseries") throw new Error(trend.op);
      // Thirty daily bars, the first starting where the recent period starts
      // and the last being today.
      expect(trend.points).toHaveLength(30);
      expect(new Date(trend.points[0].start).getTime()).toBe(
        RECENT_START.getTime()
      );
      expect(new Date(trend.points[29].start).getTime()).toBe(TODAY.getTime());
      // recentFirst, recentDraft and today; not priorLast, a second earlier.
      expect(trend.points[0].count).toBe(1);
      expect(trend.points.reduce((sum, p) => sum + p.count, 0)).toBe(3);

      // priorFirst and priorLast; not recentFirst, nor older a second before
      // the period opens.
      expect(await run("prior", POSTS)).toEqual({ op: "count", total: 2 });
    });

    it("draws bars that sum to the recent figure a count of the same span gives", async () => {
      await boot();
      const trend = await run("trend", POSTS);
      if (trend.op !== "timeseries") throw new Error(trend.op);
      const recent = await executeWidgetQuery(
        validateWidgetQuery({
          source: `collection:${POSTS}`,
          op: "count",
          status: "all",
          since: "30d",
        }),
        admin,
        { now: NOW }
      );
      expect(recent).toEqual({
        op: "count",
        total: trend.points.reduce((sum, p) => sum + p.count, 0),
      });
    });
  }
);
