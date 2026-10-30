/**
 * A row written in the last fraction of a second before a UTC day boundary,
 * read in that same second: the windowed count and the series over the same
 * range both count it, on every configured dialect.
 *
 * What only a database can settle: MySQL stores a DATETIME to the second,
 * rounding to the nearest, so the row is stored AT the boundary, in the next
 * day, while PostgreSQL and SQLite keep the written instant. The row filter
 * keeps the whole second the batch is read in (`openWindowEnd`), and the
 * series counts such a row in its last interval (`windowRowsEnd`), so the
 * chart's bars sum to the count beside it whichever dialect stores it.
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

import { servicesFor } from "./core-card-load";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run.
const ENTRIES = "srs_entries";

/** The batch's instant: a fifth of a second before midnight, UTC. */
const NOW = new Date("2026-06-15T23:59:59.800Z");
/** Written three tenths of a second before midnight: MySQL stores it at midnight. */
const WRITTEN = new Date("2026-06-15T23:59:59.700Z");

describe.each(getConfiguredTestDialects())(
  "a row written in the last second before a day boundary (%s)",
  (dialect: TestDialect) => {
    it("is counted by a series over the range in its last day, as a count of the same window counts it", async () => {
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
      const admin: ReadCaller = {
        user: { id: await superAdminUser(t, "srs-admin") },
      };
      const created = await t.nextly.create({
        collection: ENTRIES,
        data: { title: "late" },
      });
      const id = created.item.id;
      if (typeof id !== "string" && typeof id !== "number") {
        throw new Error("the entry was written with no id");
      }
      await t.adapter.update(
        `dc_${ENTRIES}`,
        { created_at: WRITTEN },
        { and: [{ column: "id", op: "=", value: id }] }
      );
      await refreshContentSources();

      const services = servicesFor(admin, NOW);
      const counted = await services.count(ENTRIES, {
        window: { range: "7d" },
      });
      const { points } = await services.timeseries(ENTRIES, { range: "7d" });
      // The population: the count keeps the row, on every dialect.
      expect(counted).toBe(1);
      // 🔴 The series counts it too, in its last day, the one it was written
      // in: a series ending at its last day's end dropped a row stored at
      // midnight, so its bars summed to one fewer than the count beside them.
      expect(points.at(-1)).toEqual({
        start: "2026-06-15T00:00:00.000Z",
        count: 1,
      });
      expect(points.reduce((sum, point) => sum + point.count, 0)).toBe(counted);
    });
  }
);
