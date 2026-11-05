/**
 * The schedule-window table through `nextly migrate`: created on a fresh
 * database, and added to an existing one that lacks it, on every dialect.
 * A window is recorded once per schedule: the database itself ignores a
 * second record of the same window on the upgraded table, which is what holds
 * a schedule to one job per window.
 *
 * @module domains/schedules/__tests__/schedule-windows-upgrade.integration.test
 */
import { afterAll, describe, expect, it } from "vitest";

import {
  availableDialects,
  withFreshDatabase,
} from "../../../__tests__/helpers/fresh-database";
import {
  migrateFresh,
  noMigrationsDir,
} from "../../../__tests__/helpers/migrate-core";

const WINDOWS = "nextly_schedule_windows";
const COLUMNS = ["created_at", "job_id", "schedule_key", "window_at"];

const { dir: NO_MIGRATIONS, remove } = noMigrationsDir("nextly-schedules-");
afterAll(remove);

describe.each(availableDialects())(
  "the schedule-window table through nextly migrate (%s)",
  dialect => {
    it("is created on a fresh database", async () => {
      await withFreshDatabase(dialect, "nextly_sw_fresh", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        expect((await fresh.columnsOf(WINDOWS)).sort()).toEqual(COLUMNS);
      });
    }, 180_000);

    it("is added to an existing database, one record per window, and a second run changes nothing", async () => {
      await withFreshDatabase(dialect, "nextly_sw_existing", async fresh => {
        await migrateFresh(fresh, NO_MIGRATIONS);
        await fresh.exec(`DROP TABLE ${WINDOWS}`);
        expect(await fresh.columnsOf(WINDOWS)).toEqual([]);

        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(true);
        expect((await fresh.columnsOf(WINDOWS)).sort()).toEqual(COLUMNS);

        const at =
          fresh.dialect === "sqlite" ? "1767225600" : "'2026-01-01 00:00:00'";
        const record = (key: string) =>
          `INSERT INTO ${WINDOWS} (schedule_key, window_at, job_id, created_at) ` +
          `VALUES ('${key}', ${at}, NULL, ${at})`;
        await fresh.exec(record("@acme/plugin:tick"));
        // The same window again is refused by the database, on the upgraded
        // table as on a fresh one.
        await expect(fresh.exec(record("@acme/plugin:tick"))).rejects.toThrow();
        // Another schedule's record of the same instant is its own window.
        await fresh.exec(record("@acme/plugin:other"));
        // Keys compare byte for byte on every dialect: case and accents make
        // different schedules, whatever the database's collation.
        await fresh.exec(record("@acme/café:tick"));
        await fresh.exec(record("@acme/cafe:tick"));
        await fresh.exec(record("@acme/Case:tick"));
        await fresh.exec(record("@acme/case:tick"));

        expect(await migrateFresh(fresh, NO_MIGRATIONS)).toBe(false);
      });
    }, 180_000);
  }
);
