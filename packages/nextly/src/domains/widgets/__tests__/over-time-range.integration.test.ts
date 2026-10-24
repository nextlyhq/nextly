/**
 * Over time's reads against a real database: its declared query set to a
 * collection, asked over each range with one frozen instant.
 *
 * What only a database can settle, on every dialect:
 * - one point per interval the range overlaps, the first and the current one
 *   partial: 31 days, 14 ISO weeks, 13 months at a mid-morning instant;
 * - only rows inside the range are counted: a row a second before the range's
 *   first instant, in the same first interval, is not, nor one after now in the
 *   same current interval;
 * - weeks start on Monday at 00:00 UTC: a Sunday's last second and a Monday's
 *   first fall in different weeks.
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
import { validateWidgetQuery, type TimeseriesRange } from "../query";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const ENTRIES = "ovt_entries";

/** The batch's one instant: a Monday, mid-morning, so no row sits on midnight. */
const NOW = new Date("2026-06-15T10:00:00.000Z");

const admin: ReadCaller = { user: { id: "admin", roles: ["super-admin"] } };

/**
 * Rows on each side of every range's first instant, beside the batch's
 * instant, and either side of a week's start. A second, not a millisecond,
 * from each line: a dialect storing whole seconds would round onto it.
 */
const ROWS: Record<string, string> = {
  // 30 days: the range starts 2026-05-16 at 10:00.
  thirtyFirst: "2026-05-16T10:00:00.000Z",
  thirtyBefore: "2026-05-16T09:59:59.000Z",
  // 90 days: the range starts 2026-03-17 at 10:00, a Tuesday.
  ninetyFirst: "2026-03-17T10:00:00.000Z",
  ninetyBefore: "2026-03-17T09:59:59.000Z",
  // 12 months: the range starts 2025-06-15 at 10:00.
  yearFirst: "2025-06-15T10:00:00.000Z",
  yearBefore: "2025-06-15T09:59:59.000Z",
  // Either side of the week starting Monday 8 June.
  sundayLast: "2026-06-07T23:59:59.000Z",
  mondayFirst: "2026-06-08T00:00:00.000Z",
  // Today: a minute before the batch's instant, and an hour after it.
  today: "2026-06-15T09:59:00.000Z",
  later: "2026-06-15T11:00:00.000Z",
};

const OVER_TIME = CORE_WIDGETS.find(widget => widget.id === "core/over-time");

/** Over time's query as core declares it, set to the collection and `range`. */
async function overRange(range: TimeseriesRange) {
  const declared = OVER_TIME?.query;
  if (declared === undefined) throw new Error("core/over-time has no query");
  const result = await executeWidgetQuery(
    validateWidgetQuery({
      ...declared,
      source: `collection:${ENTRIES}`,
      range,
    }),
    admin,
    { now: NOW }
  );
  if (result.op !== "timeseries") throw new Error(result.op);
  return {
    points: result.points,
    at: (start: string) =>
      result.points.find(point => point.start === start)?.count,
    total: result.points.reduce((sum, point) => sum + point.count, 0),
  };
}

describe.each(getConfiguredTestDialects())(
  "Over time's ranges (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<void> {
      current = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: ENTRIES,
            fields: [text({ name: "title" })],
          }),
        ],
      });
      const t = current;
      const handler = t.getService("collectionsHandler") as unknown as {
        createEntry: (
          p: Record<string, unknown>,
          data: Record<string, unknown>
        ) => Promise<{ data?: { id?: string } | null }>;
      };
      for (const [title, createdAt] of Object.entries(ROWS)) {
        const created = await handler.createEntry(
          { collectionName: ENTRIES, overrideAccess: true },
          { title }
        );
        const id = created.data?.id;
        if (typeof id !== "string") throw new Error(`no id for ${title}`);
        await t.adapter.update(
          `dc_${ENTRIES}`,
          { created_at: new Date(createdAt) },
          { and: [{ column: "id", op: "=", value: id }] }
        );
      }
      await refreshContentSources();
    }

    it("draws 30 days as the 31 days it overlaps, counting only rows inside it", async () => {
      await boot();
      const days = await overRange("30d");
      expect(days.points).toHaveLength(31);
      expect(days.points[0].start).toBe("2026-05-16T00:00:00.000Z");
      expect(days.points[30].start).toBe("2026-06-15T00:00:00.000Z");
      // thirtyFirst, not thirtyBefore a second earlier on the same day.
      expect(days.at("2026-05-16T00:00:00.000Z")).toBe(1);
      // today, not later, which is after the batch's instant.
      expect(days.at("2026-06-15T00:00:00.000Z")).toBe(1);
      expect(days.at("2026-06-07T00:00:00.000Z")).toBe(1);
      expect(days.at("2026-06-08T00:00:00.000Z")).toBe(1);
      expect(days.total).toBe(4);
    });

    it("draws 90 days as the 14 ISO weeks it overlaps, each from Monday", async () => {
      await boot();
      const weeks = await overRange("90d");
      expect(weeks.points).toHaveLength(14);
      expect(weeks.points[0].start).toBe("2026-03-16T00:00:00.000Z");
      // ninetyFirst, not ninetyBefore a second earlier in the same week.
      expect(weeks.at("2026-03-16T00:00:00.000Z")).toBe(1);
      // A Sunday's last second and a Monday's first are in different weeks.
      expect(weeks.at("2026-06-01T00:00:00.000Z")).toBe(1);
      expect(weeks.at("2026-06-08T00:00:00.000Z")).toBe(1);
      // The week of 11 May holds both thirty rows.
      expect(weeks.at("2026-05-11T00:00:00.000Z")).toBe(2);
      expect(weeks.at("2026-06-15T00:00:00.000Z")).toBe(1);
      expect(weeks.total).toBe(6);
    });

    it("draws 12 months as the 13 calendar months it overlaps", async () => {
      await boot();
      const months = await overRange("12m");
      expect(months.points).toHaveLength(13);
      expect(months.points[0].start).toBe("2025-06-01T00:00:00.000Z");
      // yearFirst, not yearBefore a second earlier in the same month.
      expect(months.at("2025-06-01T00:00:00.000Z")).toBe(1);
      expect(months.at("2026-03-01T00:00:00.000Z")).toBe(2);
      expect(months.at("2026-05-01T00:00:00.000Z")).toBe(2);
      // sundayLast, mondayFirst and today; not later.
      expect(months.at("2026-06-01T00:00:00.000Z")).toBe(3);
      expect(months.total).toBe(8);
    });
  }
);
