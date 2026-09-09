/**
 * A timeseries places rows on a timeline the same way on every database, and
 * reaches them through the pipeline that decides which rows a caller may read.
 *
 * Run against every dialect the process is configured for, because the whole
 * subject is SQL that differs per database: SQLite stores epoch seconds and
 * needs a modifier to read them as such, PostgreSQL truncates a timestamp, and
 * MySQL formats a `DATETIME`. A single-dialect run would certify one of three
 * expressions and read as coverage for all of them.
 */

import { afterEach, describe, expect, it } from "vitest";

import { date, defineCollection, number, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type Point = { start: string; count: number };

type Handler = {
  countEntries: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    data: { totalDocs: number } | null;
  }>;
  groupEntries: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: { buckets: { value: string | null; count: number }[] } | null;
  }>;
  timeseriesEntries: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    statusCode: number;
    message: string;
    data: { points: Point[]; interval: string } | null;
  }>;
  createEntry: (
    p: Record<string, unknown>,
    data: Record<string, unknown>
  ) => Promise<{ success: boolean }>;
};

const EVENTS = "ts_events";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function boot(
  dialect: TestDialect,
  rows: Array<{ occurredAt: Date; label?: string; price?: number }>
): Promise<Handler> {
  const t = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: EVENTS,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [
          date({ name: "occurredAt" }),
          text({ name: "label" }),
          // Exact decimal storage, so the label a bucket carries is decided by
          // the declared scale rather than by each driver's own codec.
          number({ name: "price", dbType: "decimal", precision: 10, scale: 2 }),
          // A date nobody may read. Grouping publishes the distinct value set,
          // so a timeline over it is the same disclosure spread over a chart.
          date({ name: "closedAt", access: { read: () => false } }),
        ],
      }),
    ],
  });
  current = t;
  const h = t.getService("collectionsHandler") as unknown as Handler;
  for (const row of rows) {
    await h.createEntry({ collectionName: EVENTS, overrideAccess: true }, row);
  }
  return h;
}

/** Rows placed a whole number of days back, so their bucket is index-addressable. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

describe.each(getConfiguredTestDialects())("a timeseries on %s", dialect => {
  it("returns one point per interval in the window, oldest first", async () => {
    const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

    const res = await h.timeseriesEntries({
      collectionName: EVENTS,
      dateField: "occurredAt",
      interval: "day",
      intervals: 5,
    });

    expect(res.success).toBe(true);
    expect(res.data?.points).toHaveLength(5);
    const starts = (res.data?.points ?? []).map(p => p.start);
    expect([...starts].sort()).toEqual(starts);
  });

  it("counts a row into the interval it happened in", async () => {
    // Positional rather than compared against a bucket the test computes with
    // the same helper the service uses: an offset of whole days back is a whole
    // number of day-buckets back in UTC, so the index is an oracle the
    // implementation had no hand in choosing.
    const h = await boot(dialect, [
      { occurredAt: daysAgo(0) },
      { occurredAt: daysAgo(0) },
      { occurredAt: daysAgo(2) },
    ]);

    const res = await h.timeseriesEntries({
      collectionName: EVENTS,
      dateField: "occurredAt",
      interval: "day",
      intervals: 5,
    });

    const counts = (res.data?.points ?? []).map(p => p.count);
    // index 4 is today, index 2 is two days back.
    expect(counts).toEqual([0, 0, 1, 0, 2]);
  });

  it("reports an interval with no rows as zero rather than omitting it", async () => {
    // A GROUP BY cannot return a bucket it never grouped, so without the fill
    // a quiet day is absent and a line drawn through the gap reads as steady
    // activity rather than none.
    const h = await boot(dialect, [
      { occurredAt: daysAgo(0) },
      { occurredAt: daysAgo(3) },
    ]);

    const res = await h.timeseriesEntries({
      collectionName: EVENTS,
      dateField: "occurredAt",
      interval: "day",
      intervals: 4,
    });

    expect((res.data?.points ?? []).map(p => p.count)).toEqual([1, 0, 0, 1]);
  });

  it("leaves a row older than the window out of every point", async () => {
    // Names what it can observe. A row outside the window must not be folded
    // into the OLDEST point, which is what an implementation that clamped an
    // out-of-range bucket to the window's start would do.
    //
    // The lower bound the query puts on the date column is a separate property
    // and is NOT covered here: it bounds how much the database scans, and the
    // points are built from the window, so removing it changes nothing an
    // assertion on the answer can see. Verified by reading the statement, not
    // by this test.
    const h = await boot(dialect, [
      { occurredAt: daysAgo(0) },
      { occurredAt: daysAgo(9) },
    ]);

    const res = await h.timeseriesEntries({
      collectionName: EVENTS,
      dateField: "occurredAt",
      interval: "day",
      intervals: 3,
    });

    const counts = (res.data?.points ?? []).map(p => p.count);
    expect(counts).toEqual([0, 0, 1]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("buckets by the hour without carrying the row's own minute", async () => {
    const h = await boot(dialect, [
      { occurredAt: new Date(Date.now() - 2 * HOUR_MS) },
      { occurredAt: new Date(Date.now() - 2 * HOUR_MS - 60 * 1000) },
    ]);

    const res = await h.timeseriesEntries({
      collectionName: EVENTS,
      dateField: "occurredAt",
      interval: "hour",
      intervals: 6,
    });

    const points = res.data?.points ?? [];
    expect(points).toHaveLength(6);
    for (const point of points) {
      // Every point is the start of its hour, so two rows a minute apart in one
      // hour are one bucket.
      expect(point.start).toMatch(/T\d{2}:00:00\.000Z$/);
    }
    expect(points.reduce((sum, p) => sum + p.count, 0)).toBe(2);
  });

  it("starts every day point at midnight UTC", async () => {
    const h = await boot(dialect, [{ occurredAt: daysAgo(1) }]);

    const res = await h.timeseriesEntries({
      collectionName: EVENTS,
      dateField: "occurredAt",
      interval: "day",
      intervals: 3,
    });

    for (const point of res.data?.points ?? []) {
      expect(point.start).toMatch(/T00:00:00\.000Z$/);
    }
  });

  it("describes the same rows a count of the same query describes", async () => {
    // The claim the shared pipeline exists to make, asserted against the count
    // rather than a number written here, so a filter added to one read and not
    // the other fails this.
    const h = await boot(dialect, [
      { occurredAt: daysAgo(0), label: "a" },
      { occurredAt: daysAgo(1), label: "a" },
      { occurredAt: daysAgo(2), label: "b" },
    ]);

    const where = { label: { equals: "a" } };
    const counted = await h.countEntries({ collectionName: EVENTS, where });
    const series = await h.timeseriesEntries({
      collectionName: EVENTS,
      dateField: "occurredAt",
      interval: "day",
      intervals: 7,
      where,
    });

    const total = (series.data?.points ?? []).reduce(
      (sum, p) => sum + p.count,
      0
    );
    expect(total).toBe(counted.data?.totalDocs);
    expect(total).toBe(2);
  });

  it("refuses a field that does not store a date", async () => {
    // Without this a text column reaches the bucketing expression, where each
    // dialect answers something different for text that is not a date.
    const h = await boot(dialect, [{ occurredAt: daysAgo(0), label: "a" }]);

    const res = await h.timeseriesEntries({
      collectionName: EVENTS,
      dateField: "label",
      interval: "day",
    });

    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res)).toContain("FIELD_NOT_A_DATE");
  });

  it("refuses a date field the caller may not read", async () => {
    // The refusals a grouped read makes apply unchanged, because the date key
    // travels as the group key rather than through a second path.
    const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

    const res = await h.timeseriesEntries({
      collectionName: EVENTS,
      dateField: "closedAt",
      interval: "day",
    });

    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  it("refuses an interval it has no expression for", async () => {
    const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

    const res = await h.timeseriesEntries({
      collectionName: EVENTS,
      dateField: "occurredAt",
      interval: "fortnight",
    });

    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  it("bounds a window that asks for more intervals than the cap", async () => {
    const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

    const res = await h.timeseriesEntries({
      collectionName: EVENTS,
      dateField: "occurredAt",
      interval: "day",
      intervals: 100000,
    });

    expect(res.success).toBe(true);
    expect(res.data?.points.length).toBe(366);
  });

  it("falls back to the default window rather than failing on a computed NaN", async () => {
    const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

    const res = await h.timeseriesEntries({
      collectionName: EVENTS,
      dateField: "occurredAt",
      interval: "day",
      intervals: Number.NaN,
    });

    expect(res.success).toBe(true);
    expect(res.data?.points).toHaveLength(30);
  });
});

describe.each(getConfiguredTestDialects())(
  "a decimal group key on %s",
  dialect => {
    it("labels its buckets to the scale the field declared", async () => {
      // SQLite builds its numeric columns to read back as a JS number and
      // answers 1, while PostgreSQL and MySQL use the default string codec and
      // answer "1.00". Identical stored data must not label differently per
      // adapter, so the label comes from the declared scale.
      const h = await boot(dialect, [
        { occurredAt: daysAgo(0), price: 1 },
        { occurredAt: daysAgo(0), price: 1 },
        { occurredAt: daysAgo(0), price: 2.5 },
      ]);

      const res = await h.groupEntries({
        collectionName: EVENTS,
        groupBy: "price",
      });

      expect(res.success).toBe(true);
      expect(res.data?.buckets).toEqual([
        { value: "1.00", count: 2 },
        { value: "2.50", count: 1 },
      ]);
    });
  }
);
