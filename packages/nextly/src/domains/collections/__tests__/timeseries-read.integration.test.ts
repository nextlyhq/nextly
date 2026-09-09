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

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerHook, unregisterHook } from "../../../hooks";
import type { HookHandler } from "../../../hooks/types";

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
  rows: Array<{
    occurredAt: Date;
    label?: string;
    price?: number;
    nestedAt?: Date;
  }>
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
          // Its values live in the `_locales` companion rather than on this
          // table, so the column lookup finds nothing.
          date({ name: "translatedAt", localized: true }),
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

/**
 * ONE instant per test, shared by the fixtures and the window they are read
 * against.
 *
 * Two reads of the system clock either side of a fixture write can straddle
 * UTC midnight -- `boot` creates tables and inserts rows, so the gap is
 * seconds, not microseconds. Every row would then move one bucket left while
 * the positional assertions below still expect fixed offsets. Settling both
 * against one captured instant removes the race rather than narrowing it.
 */
let clock = new Date();
beforeEach(() => {
  clock = new Date();
});

/** Rows placed a whole number of days back, so their bucket is index-addressable. */
function daysAgo(days: number): Date {
  return new Date(clock.getTime() - days * DAY_MS);
}

/** The same anchor the fixtures used, handed to the read as its window end. */
function hoursAgo(hours: number): Date {
  return new Date(clock.getTime() - hours * HOUR_MS);
}

describe.each(getConfiguredTestDialects())("a timeseries on %s", dialect => {
  it("returns one point per interval in the window, oldest first", async () => {
    const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

    const res = await h.timeseriesEntries({
      collectionName: EVENTS,
      now: clock,
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
      now: clock,
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
      now: clock,
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
      now: clock,
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
      { occurredAt: hoursAgo(2) },
      { occurredAt: new Date(hoursAgo(2).getTime() - 60 * 1000) },
    ]);

    const res = await h.timeseriesEntries({
      collectionName: EVENTS,
      now: clock,
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
      now: clock,
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
      now: clock,
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
      now: clock,
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
      now: clock,
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
      now: clock,
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
      now: clock,
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
      now: clock,
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

describe.each(getConfiguredTestDialects())(
  "a timeseries over a system column on %s",
  dialect => {
    it("buckets by createdAt, which no author declares", async () => {
      // `created_at` is INJECTED rather than declared, so it is absent from the
      // author's field list and the descriptor lookup that reads that list
      // cannot see it -- while it is the column a timeline is most often drawn
      // over, and the one the documentation uses.
      const h = await boot(dialect, [
        { occurredAt: daysAgo(0) },
        { occurredAt: daysAgo(0) },
      ]);

      const res = await h.timeseriesEntries({
        collectionName: EVENTS,
        now: clock,
        dateField: "createdAt",
        interval: "day",
        intervals: 3,
      });

      expect(res.success).toBe(true);
      expect(res.data?.points).toHaveLength(3);
      // Both rows were written now, so today's point carries them.
      expect(res.data?.points.at(-1)?.count).toBe(2);
    });

    it("accepts the snake spelling of the same system column", async () => {
      const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

      const res = await h.timeseriesEntries({
        collectionName: EVENTS,
        now: clock,
        dateField: "created_at",
        interval: "day",
        intervals: 2,
      });

      expect(res.success).toBe(true);
      expect(res.data?.points.at(-1)?.count).toBe(1);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a refused timeline on %s",
  dialect => {
    it("does not run the read hooks for a key that stores no date", async () => {
      // `beforeRead` is ordinary user code that records audit entries and
      // spends rate-limit budget. A request that was never going to be answered
      // must not charge the caller for work, so the date-key refusal has to
      // happen inside the plan rather than after it.
      const h = await boot(dialect, [{ occurredAt: daysAgo(0), label: "a" }]);

      let ran = 0;
      const handler: HookHandler = (args: unknown) => {
        ran += 1;
        return args;
      };
      registerHook("beforeRead", EVENTS, handler);
      try {
        const res = await h.timeseriesEntries({
          collectionName: EVENTS,
          now: clock,
          dateField: "label",
          interval: "day",
        });
        expect(res.success).toBe(false);
        expect(JSON.stringify(res)).toContain("FIELD_NOT_A_DATE");
      } finally {
        unregisterHook("beforeRead", EVENTS, handler);
      }

      expect(ran).toBe(0);
    });

    it("still runs the read hooks for a timeline it accepts", async () => {
      // The control. Without it, a plan that refused EVERY timeline would
      // satisfy the assertion above while breaking the feature.
      const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

      let ran = 0;
      const handler: HookHandler = (args: unknown) => {
        ran += 1;
        return args;
      };
      registerHook("beforeRead", EVENTS, handler);
      try {
        const res = await h.timeseriesEntries({
          collectionName: EVENTS,
          now: clock,
          dateField: "occurredAt",
          interval: "day",
          intervals: 2,
        });
        expect(res.success).toBe(true);
      } finally {
        unregisterHook("beforeRead", EVENTS, handler);
      }

      expect(ran).toBeGreaterThan(0);
    });

    it("leaves a future-dated row out of every point", async () => {
      // The scan is bounded ABOVE as well as below, because a date field holds
      // future values -- a scheduled publication, an event date. That bound
      // limits what the database reads and cannot change this answer, since the
      // points are built from the window; it is verified by reading the
      // statement. What this pins is that a future row is not folded into the
      // most recent point.
      const h = await boot(dialect, [
        { occurredAt: daysAgo(0) },
        { occurredAt: daysAgo(-5) },
      ]);

      const res = await h.timeseriesEntries({
        collectionName: EVENTS,
        now: clock,
        dateField: "occurredAt",
        interval: "day",
        intervals: 3,
      });

      const counts = (res.data?.points ?? []).map(p => p.count);
      expect(counts).toEqual([0, 0, 1]);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a decimal bucket label on %s",
  dialect => {
    it("keeps apart two values the database kept apart", async () => {
      // SQLite's NUMERIC affinity is best-effort and does not enforce the
      // declared scale, so a column declared with scale 2 can hold 1.001 and
      // 1.002 as two distinct groups. Rounding the label to the scale would
      // hand back separate counts under one label -- the merge a bucket label
      // exists to prevent.
      const h = await boot(dialect, [
        { occurredAt: daysAgo(0), price: 1.001 },
        { occurredAt: daysAgo(0), price: 1.002 },
      ]);

      const res = await h.groupEntries({
        collectionName: EVENTS,
        groupBy: "price",
      });

      expect(res.success).toBe(true);
      const labels = (res.data?.buckets ?? []).map(b => b.value);
      // However each adapter chose to STORE these, no two buckets may share a
      // label: the counts behind them are different rows.
      expect(new Set(labels).size).toBe(labels.length);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a localized date key on %s",
  dialect => {
    it("is refused for being localized, not for being missing", async () => {
      // Its column lives in the `_locales` companion, so the lookup finds
      // nothing on this table. Saying "is not a column on this collection"
      // reads as a typo for a field that is declared and spelled correctly,
      // and sends the reader looking in the wrong place.
      const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

      const res = await h.timeseriesEntries({
        collectionName: EVENTS,
        now: clock,
        dateField: "translatedAt",
        interval: "day",
      });

      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(400);
      const body = JSON.stringify(res);
      expect(body).toContain("localized field");
      expect(body).not.toContain("is not a column on this collection");
    });

    it("still says 'not a column' for a key that names nothing", async () => {
      // The control. Without it, a refusal that called EVERY missing key
      // localized would satisfy the assertion above.
      const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

      const res = await h.timeseriesEntries({
        collectionName: EVENTS,
        now: clock,
        dateField: "noSuchField",
        interval: "day",
      });

      expect(res.success).toBe(false);
      expect(JSON.stringify(res)).toContain(
        "is not a column on this collection"
      );
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a window anchored to a given instant on %s",
  dialect => {
    it("ends at the interval the caller named, not at the read's own clock", async () => {
      // The window end is the caller's, so a report can be asked for as of a
      // period end rather than as of whenever it happened to run. It is also
      // what makes the positional assertions in this file deterministic: the
      // fixtures and the window are settled against ONE instant.
      const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

      const asOf = new Date("2026-03-04T05:06:07.000Z");
      const res = await h.timeseriesEntries({
        collectionName: EVENTS,
        now: asOf,
        dateField: "occurredAt",
        interval: "day",
        intervals: 3,
      });

      expect(res.success).toBe(true);
      expect((res.data?.points ?? []).map(p => p.start)).toEqual([
        "2026-03-02T00:00:00.000Z",
        "2026-03-03T00:00:00.000Z",
        "2026-03-04T00:00:00.000Z",
      ]);
      // The row written "today" is far outside that window, so every point is
      // empty -- which is also the control that the anchor was honoured rather
      // than ignored in favour of the system clock.
      expect((res.data?.points ?? []).every(p => p.count === 0)).toBe(true);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "an unusable window anchor on %s",
  dialect => {
    it("is refused by name rather than reaching the statement", async () => {
      // `new Date("nonsense")` is a Date the type accepts whose time is NaN.
      // Left to reach the query, MySQL refuses it while building the bound
      // while PostgreSQL and SQLite carry it into the statement or into
      // `toISOString`, so one bad input answered a 400 on one database and a
      // 500 on the others.
      const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

      const res = await h.timeseriesEntries({
        collectionName: EVENTS,
        now: new Date("nonsense"),
        dateField: "occurredAt",
        interval: "day",
      });

      expect(res.success).toBe(false);
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res)).toContain("TIMESERIES_WINDOW_INVALID");
    });

    it("does not run the read hooks for an anchor it refuses", async () => {
      // Same reason the date-key refusal happens inside the plan: a request
      // that was never going to be answered must not spend rate-limit budget
      // or leave an audit trail of a read that did not happen.
      const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

      let ran = 0;
      const handler: HookHandler = (args: unknown) => {
        ran += 1;
        return args;
      };
      registerHook("beforeRead", EVENTS, handler);
      try {
        const res = await h.timeseriesEntries({
          collectionName: EVENTS,
          now: new Date("nonsense"),
          dateField: "occurredAt",
          interval: "day",
        });
        expect(res.success).toBe(false);
      } finally {
        unregisterHook("beforeRead", EVENTS, handler);
      }

      expect(ran).toBe(0);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a window that reaches before the epoch on %s",
  dialect => {
    it("still counts the recent rows", async () => {
      // 366 yearly intervals is the DOCUMENTED maximum, and in 2026 that window
      // starts in 1661. On MySQL the lower bound is rendered with
      // `from_unixtime`, which answers NULL for a negative epoch -- and
      // `column >= NULL` matches nothing, so the whole series reported zeros
      // while rows existed. Measured: `from_unixtime(-9750000000)` is NULL and
      // a probe table holding one row returns 0 for that predicate.
      const h = await boot(dialect, [
        { occurredAt: daysAgo(0) },
        { occurredAt: daysAgo(0) },
      ]);

      const res = await h.timeseriesEntries({
        collectionName: EVENTS,
        now: clock,
        dateField: "occurredAt",
        interval: "year",
        intervals: 366,
      });

      expect(res.success).toBe(true);
      expect(res.data?.points).toHaveLength(366);
      const total = (res.data?.points ?? []).reduce((s, p) => s + p.count, 0);
      expect(total).toBe(2);
      // In the most recent year, which is where both rows were written.
      expect(res.data?.points.at(-1)?.count).toBe(2);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a malformed date field on %s",
  dialect => {
    it("is refused by name rather than as a server fault", async () => {
      // The public Direct API is callable from JavaScript, where the parameter
      // type binds nothing. A non-string reached `toSnakeCase`, whose
      // `.replace` threw a raw TypeError that the service caught as an
      // unclassified 500 -- unlike every other malformed argument, which gets a
      // named refusal.
      const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

      for (const bad of [123, 0, false, Number.NaN, {}] as unknown[]) {
        const res = await h.timeseriesEntries({
          collectionName: EVENTS,
          now: clock,
          dateField: bad as string,
          interval: "day",
        });

        // `0`, `false` and `NaN` are the ones that matter: they are FALSY as
        // well as wrong, so a guard placed after an `if (!value) return` never
        // sees them and they reach `toSnakeCase`, whose `.replace` throws a raw
        // TypeError the service reports as an unclassified 500.
        expect(res.success, `${String(bad)} was accepted`).toBe(false);
        expect(
          res.statusCode,
          `${String(bad)} was not a validation error`
        ).toBe(400);
        expect(JSON.stringify(res)).toContain("FIELD_NOT_GROUPABLE");
      }
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a window no stored row can fall in on %s",
  dialect => {
    it("answers every interval as zero", async () => {
      // Entirely after what a MySQL TIMESTAMP can hold.
      //
      // This pins the ANSWER, which is all it can pin. Whether the read
      // short-circuits or runs an unbounded GROUP BY and then discards every
      // bucket, the points come out identical -- so removing the short-circuit
      // fails nothing here, and that was confirmed rather than assumed. What
      // the short-circuit buys is not scanning a whole table to produce this,
      // and that is verified by reading the code, not by this test.
      const h = await boot(dialect, [
        { occurredAt: daysAgo(0) },
        { occurredAt: daysAgo(1) },
      ]);

      const res = await h.timeseriesEntries({
        collectionName: EVENTS,
        now: new Date("2400-01-01T00:00:00.000Z"),
        dateField: "occurredAt",
        interval: "day",
        intervals: 3,
      });

      expect(res.success).toBe(true);
      expect(res.data?.points).toHaveLength(3);
      expect((res.data?.points ?? []).every(p => p.count === 0)).toBe(true);
      // The points still describe the window asked for, so a caller cannot tell
      // this apart from a queried answer -- which is the point.
      expect(res.data?.points.at(-1)?.start).toBe("2400-01-01T00:00:00.000Z");
    });

    it("still counts rows for a window that overlaps the range", async () => {
      // The control: a short-circuit that fired for every window would satisfy
      // the assertion above while making the whole feature answer zero.
      const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

      const res = await h.timeseriesEntries({
        collectionName: EVENTS,
        now: clock,
        dateField: "occurredAt",
        interval: "day",
        intervals: 2,
      });

      expect(res.data?.points.at(-1)?.count).toBe(1);
    });

    it("counts a row inside a window whose two ends are BOTH unstorable", async () => {
      // The second control, and the one the case above cannot supply. Two
      // unrepresentable ends describe two opposite windows: one lying past the
      // storable range, and one SURROUNDING it. 366 yearly intervals anchored
      // in 2040 run from 1675 to 2041, so both ends are dropped on MySQL while
      // every row a `TIMESTAMP` can hold falls inside -- and deciding from the
      // rendered bounds rather than from the raw window answers zeros for 1970
      // through 2038 without reading a row.
      //
      // Reachable from an ordinary request: 366 is the documented maximum, and
      // the anchor is a caller's own reporting parameter.
      const h = await boot(dialect, [{ occurredAt: daysAgo(0) }]);

      const res = await h.timeseriesEntries({
        collectionName: EVENTS,
        now: new Date("2040-06-01T00:00:00.000Z"),
        dateField: "occurredAt",
        interval: "year",
        intervals: 366,
      });

      expect(res.success).toBe(true);
      // Summed rather than positional: the row's bucket is this year, whose
      // offset from the window's end moves with the calendar.
      const counted = (res.data?.points ?? []).reduce(
        (total, point) => total + point.count,
        0
      );
      expect(counted).toBe(1);
    });
  }
);
