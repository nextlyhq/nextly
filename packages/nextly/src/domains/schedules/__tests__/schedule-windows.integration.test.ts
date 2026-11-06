/**
 * A plugin's schedule runs once per window, on every dialect.
 *
 * Each jobs pass looks at each schedule's latest window at or before now, and
 * records it, in one transaction with its job, unless it is recorded already.
 * So a window's job is enqueued once: after that job has finished, with two
 * runners at once, and after a runner that stopped either side of the commit.
 * A schedule's first window is the first that opens after a pass first sees
 * it. Old windows are pruned, but never a schedule's latest.
 *
 * The passes are driven with a chosen `now`, through the same pass the jobs
 * route runs.
 *
 * @module domains/schedules/__tests__/schedule-windows.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { container } from "../../../di/container";
import { getInitializedPluginContext } from "../../../di/register";
import { defineJob, type JobRegistry } from "../../jobs/job-registry";
import { runJobsPass } from "../../jobs/jobs-runner";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { parseCron } from "../cron";
import { scheduleKeyOf, type CollectedSchedule } from "../collect-schedules";
import { scheduleWindows } from "../schedule-windows";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const PLUGIN = "@test/sw";
const JOB = "test-sw:tick";

interface WindowRow {
  scheduleKey: string;
  windowAt: Date | string | number;
  jobId: string | null;
}

interface JobRow {
  id: string;
  input: unknown;
  state: string;
}

/** Boot with a plugin whose schedule runs `JOB` on `cron`. */
async function boot(
  dialect: TestDialect,
  cron: string,
  ran: unknown[] = []
): Promise<TestNextly> {
  const plugin = definePlugin({
    name: PLUGIN,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      jobs: [
        defineJob({
          slug: JOB,
          handler: async input => {
            ran.push(input);
          },
        }),
      ],
      schedules: [
        {
          slug: "tick",
          cron,
          job: JOB,
          // The window is the schedule's to say: input naming one is replaced.
          input: { kind: "scheduled", window: "forged" },
        },
      ],
    },
  });
  current = await createTestNextly(
    dialect === "sqlite"
      ? { plugins: [plugin] }
      : { dialect, plugins: [plugin] }
  );
  // A PostgreSQL or MySQL leg that silently booted SQLite would prove nothing
  // about those databases.
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

/** One jobs pass, as the jobs route runs it, at `at`. */
function pass(t: TestNextly, at: string) {
  return runJobsPass(t.adapter, container.get<JobRegistry>("jobRegistry"), {
    now: () => new Date(at),
    maxDurationMs: 10_000,
  });
}

function jobsOf(t: TestNextly): Promise<JobRow[]> {
  return t.adapter.select<JobRow>("nextly_jobs", {
    where: { and: [{ column: "slug", op: "=", value: JOB }] },
  });
}

function windowsOf(t: TestNextly): Promise<WindowRow[]> {
  return t.adapter.select<WindowRow>("nextly_schedule_windows", {
    where: {
      and: [{ column: "scheduleKey", op: "=", value: hourly().key }],
    },
  });
}

/** A window's time as an ISO instant, however the dialect hands it back. */
function iso(value: Date | string | number): string {
  const date =
    typeof value === "number"
      ? new Date(value < 1e12 ? value * 1000 : value)
      : new Date(value);
  return date.toISOString();
}

/** The job input as stored: JSON text on SQLite, a value elsewhere. */
function inputOf(row: JobRow): unknown {
  return typeof row.input === "string" ? JSON.parse(row.input) : row.input;
}

/** The plugin's hourly schedule, as collection would give it. */
/** The plugin's schedule `slug` read with `cron`, keyed as collection keys it. */
function defined(cron: string, slug = "tick"): CollectedSchedule {
  const parsed = parseCron(cron);
  return {
    key: scheduleKeyOf(PLUGIN, slug, parsed, "UTC"),
    plugin: PLUGIN,
    slug,
    cron: parsed,
    timeZone: "UTC",
    job: JOB,
    input: {},
  };
}

/** The plugin's hourly schedule, as the booted plugin declares it. */
function hourly(): CollectedSchedule {
  return defined("0 * * * *");
}

describe.each(getConfiguredTestDialects())(
  "a plugin's schedule runs once per window (%s)",
  dialect => {
    it("refuses to start with a schedule that cannot run, naming the plugin", async () => {
      await expect(boot(dialect, "every hour")).rejects.toThrow(PLUGIN);
    });

    it("runs a schedule in the earlier shape once per window, its handler given the plugin's started context", async () => {
      const seen: unknown[] = [];
      const plugin = definePlugin({
        name: "@test/earlier",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          schedules: [
            {
              name: "tick",
              schedule: 3_600_000,
              handler: ctx => {
                seen.push(ctx);
              },
            },
          ],
        },
      });
      current = await createTestNextly(
        dialect === "sqlite"
          ? { plugins: [plugin] }
          : { dialect, plugins: [plugin] }
      );
      expect(current.adapter.dialect).toBe(dialect);
      await pass(current, "2026-11-05T10:30:00.000Z");
      await pass(current, "2026-11-05T11:05:00.000Z");
      await pass(current, "2026-11-05T11:35:00.000Z");
      expect(seen).toHaveLength(1);
      const started = getInitializedPluginContext("@test/earlier");
      expect(started).toBeDefined();
      expect(seen[0]).toBe(started);
    });

    it("enqueues a due window's job once, and not again in the same window after the job has finished", async () => {
      const ran: unknown[] = [];
      const t = await boot(dialect, "0 * * * *", ran);
      // First sight: the 10:00 window is recorded with no job.
      await pass(t, "2026-11-05T10:30:00.000Z");
      expect(await jobsOf(t)).toHaveLength(0);

      await pass(t, "2026-11-05T11:05:00.000Z");
      const jobs = await jobsOf(t);
      expect(jobs).toHaveLength(1);
      // The pass that enqueued it also ran it.
      expect(jobs[0].state).toBe("done");
      expect(ran).toHaveLength(1);

      // Same window, job finished: the window's record, not the job queue's
      // released dedupe key, says it was had.
      await pass(t, "2026-11-05T11:40:00.000Z");
      expect(await jobsOf(t)).toHaveLength(1);
      expect(ran).toHaveLength(1);
    });

    it("gives the job its window, which the schedule's own input cannot replace", async () => {
      const t = await boot(dialect, "0 * * * *");
      await pass(t, "2026-11-05T10:30:00.000Z");
      await pass(t, "2026-11-05T11:05:00.000Z");
      const [job] = await jobsOf(t);
      expect(inputOf(job)).toEqual({
        kind: "scheduled",
        window: "2026-11-05T11:00:00.000Z",
      });
    });

    it("two runners sweeping the same window at once enqueue one job", async () => {
      const t = await boot(dialect, "0 * * * *");
      await pass(t, "2026-11-05T10:30:00.000Z");
      await Promise.all([
        pass(t, "2026-11-05T11:05:00.000Z"),
        pass(t, "2026-11-05T11:05:00.000Z"),
      ]);
      expect(await jobsOf(t)).toHaveLength(1);
    });

    it("the runner that loses a window to another is told nothing went wrong", async () => {
      // The losing insert is ignored, not raised: a raised conflict would
      // also leave one job, through the error path, and say so here.
      const t = await boot(dialect, "0 * * * *");
      const errors: unknown[] = [];
      const runner = () =>
        scheduleWindows(t.adapter, [hourly()], {
          onError: error => errors.push(error),
        });
      await runner().sweep(new Date("2026-11-05T10:30:00.000Z"));
      await Promise.all([
        runner().sweep(new Date("2026-11-05T11:05:00.000Z")),
        runner().sweep(new Date("2026-11-05T11:05:00.000Z")),
      ]);
      expect(errors).toEqual([]);
      expect(await jobsOf(t)).toHaveLength(1);
    });

    it("a schedule whose cron changes waits for the new cron's next window", async () => {
      const t = await boot(dialect, "0 * * * *");
      await scheduleWindows(t.adapter, [hourly()]).sweep(
        new Date("2026-11-05T10:30:00.000Z")
      );
      // Moved to half past: 10:30 is later than the 10:00 recorded, but it
      // was read with another cron, so it is a first sight, not a window.
      const halfPast = scheduleWindows(t.adapter, [defined("30 * * * *")]);
      await halfPast.sweep(new Date("2026-11-05T10:45:00.000Z"));
      expect(await jobsOf(t)).toHaveLength(0);
      await halfPast.sweep(new Date("2026-11-05T11:35:00.000Z"));
      expect(await jobsOf(t)).toHaveLength(1);
    });

    it("a schedule changed to a rarer cron runs at the first of its windows after the change", async () => {
      const t = await boot(dialect, "0 * * * *");
      await scheduleWindows(t.adapter, [hourly()]).sweep(
        new Date("2026-11-05T09:30:00.000Z")
      );
      await scheduleWindows(t.adapter, [hourly()]).sweep(
        new Date("2026-11-05T10:30:00.000Z")
      );
      expect(await jobsOf(t)).toHaveLength(1);
      // Hourly to yearly in November: the yearly window of January 2026
      // lies before the hourly ones recorded, and is this definition's first
      // sight; January 2027 is its first job.
      const yearly = scheduleWindows(t.adapter, [defined("@yearly")]);
      await yearly.sweep(new Date("2026-11-05T11:30:00.000Z"));
      expect(await jobsOf(t)).toHaveLength(1);
      await yearly.sweep(new Date("2027-01-01T00:05:00.000Z"));
      expect(await jobsOf(t)).toHaveLength(2);
    });

    it("a changed schedule whose first window was recorded under the old one runs at its next window", async () => {
      const t = await boot(dialect, "0 * * * *");
      await scheduleWindows(t.adapter, [hourly()]).sweep(
        new Date("2026-11-05T10:30:00.000Z")
      );
      // Every two hours: its window at 10:00 is the instant already recorded.
      const everyTwo = scheduleWindows(t.adapter, [defined("0 */2 * * *")]);
      await everyTwo.sweep(new Date("2026-11-05T10:45:00.000Z"));
      expect(await jobsOf(t)).toHaveLength(0);
      await everyTwo.sweep(new Date("2026-11-05T12:05:00.000Z"));
      expect(await jobsOf(t)).toHaveLength(1);
    });

    it("prunes the windows of a schedule no longer declared", async () => {
      const t = await boot(dialect, "0 * * * *");
      const removed: CollectedSchedule = {
        ...hourly(),
        key: `${PLUGIN}:removed`,
        slug: "removed",
      };
      const before = scheduleWindows(t.adapter, [removed]);
      await before.sweep(new Date("2026-08-01T10:30:00.000Z"));
      await before.sweep(new Date("2026-08-01T11:30:00.000Z"));
      // The installation no longer declares it; its old windows go.
      await scheduleWindows(t.adapter, [hourly()]).prune(
        new Date("2026-10-01T00:00:00.000Z"),
        100
      );
      const left = await t.adapter.select<WindowRow>(
        "nextly_schedule_windows",
        {
          where: {
            and: [
              { column: "scheduleKey", op: "=", value: `${PLUGIN}:removed` },
            ],
          },
        }
      );
      expect(left).toEqual([]);
    });

    it("a definition reverted to within the retention resumes, running its latest window once", async () => {
      const t = await boot(dialect, "0 * * * *");
      await scheduleWindows(t.adapter, [hourly()]).sweep(
        new Date("2026-11-05T10:05:00.000Z")
      );
      await scheduleWindows(t.adapter, [defined("30 * * * *")]).sweep(
        new Date("2026-11-05T10:40:00.000Z")
      );
      // Back to on the hour: its windows are its own, kept, so it resumes
      // and runs 11:00, the latest that opened, once.
      const back = scheduleWindows(t.adapter, [hourly()]);
      await back.sweep(new Date("2026-11-05T11:10:00.000Z"));
      await back.sweep(new Date("2026-11-05T11:40:00.000Z"));
      expect(await jobsOf(t)).toHaveLength(1);
    });

    it("two definitions of one schedule, live at once in a rolling deploy, each run their own windows", async () => {
      const t = await boot(dialect, "0 * * * *");
      const oldVersion = scheduleWindows(t.adapter, [hourly()]);
      const newVersion = scheduleWindows(t.adapter, [defined("30 * * * *")]);
      for (const [version, at] of [
        [oldVersion, "2026-11-05T10:05:00.000Z"],
        [newVersion, "2026-11-05T10:40:00.000Z"],
        [oldVersion, "2026-11-05T11:05:00.000Z"],
        [newVersion, "2026-11-05T11:40:00.000Z"],
      ] as const) {
        await version.sweep(new Date(at));
      }
      // Neither suppresses the other: 11:00 under one, 11:30 under the other.
      expect(await jobsOf(t)).toHaveLength(2);
    });

    it.each([5, 7, 60])(
      "past its deadline each pass sweeps one schedule, and passes every %i minutes reach them all",
      async minutes => {
        const t = await boot(dialect, "0 * * * *");
        const schedules = Array.from({ length: 10 }, (_, index) =>
          defined("0 * * * *", `s${index}`)
        );
        // Every schedule seen at 10:30, so 10:00 is each one's latest window.
        await scheduleWindows(t.adapter, schedules).sweep(
          new Date("2026-11-05T10:30:00.000Z")
        );
        // From 11:00 each pass, a fresh process, has time for one schedule.
        for (let step = 0; step < schedules.length; step += 1) {
          await scheduleWindows(t.adapter, schedules).sweep(
            new Date(
              Date.parse("2026-11-05T11:00:00.000Z") + step * minutes * 60_000
            ),
            Date.now() - 1
          );
        }
        const rows = await t.adapter.select<WindowRow>(
          "nextly_schedule_windows"
        );
        const run = new Set(
          rows
            .filter(row => row.jobId !== null)
            .map(row => String(row.scheduleKey))
        );
        expect(run).toEqual(new Set(schedules.map(schedule => schedule.key)));
      }
    );

    it("past its deadline a pass sees a newly declared schedule before sweeping those already seen", async () => {
      const t = await boot(dialect, "0 * * * *");
      const seen = [defined("0 * * * *", "s0"), defined("0 * * * *", "s1")];
      await scheduleWindows(t.adapter, seen).sweep(
        new Date("2026-11-05T10:30:00.000Z")
      );
      // At 11:05 both are due, and a third is declared; the pass has time
      // for one, and it is the new one's.
      const fresh = defined("0 * * * *", "fresh");
      await scheduleWindows(t.adapter, [...seen, fresh]).sweep(
        new Date("2026-11-05T11:05:00.000Z"),
        Date.now() - 1
      );
      const rows = await t.adapter.select<WindowRow>("nextly_schedule_windows");
      expect(
        rows.filter(row => String(row.scheduleKey) === fresh.key)
      ).toHaveLength(1);
      expect(await jobsOf(t)).toEqual([]);
    });

    it("two runners sweeping several schedules at once enqueue each window once", async () => {
      const t = await boot(dialect, "0 * * * *");
      const schedules = Array.from({ length: 3 }, (_, index) =>
        defined("0 * * * *", `s${index}`)
      );
      const errors: unknown[] = [];
      const runner = () =>
        scheduleWindows(t.adapter, schedules, {
          onError: error => errors.push(error),
        });
      await runner().sweep(new Date("2026-11-05T10:30:00.000Z"));
      // Both read the same schedules as due, in the same order.
      await Promise.all([
        runner().sweep(new Date("2026-11-05T11:05:00.000Z")),
        runner().sweep(new Date("2026-11-05T11:05:00.000Z")),
      ]);
      expect(errors).toEqual([]);
      expect(await jobsOf(t)).toHaveLength(3);
    });

    it("prunes the oldest windows first, whichever schedule they belong to", async () => {
      const t = await boot(dialect, "0 * * * *");
      const second = defined("30 * * * *", "second");
      const first = scheduleWindows(t.adapter, [hourly()]);
      for (const at of [
        "2026-09-01T10:05:00.000Z",
        "2026-09-01T11:05:00.000Z",
        "2026-09-01T12:05:00.000Z",
        "2026-09-01T13:05:00.000Z",
        "2026-11-04T12:05:00.000Z",
      ]) {
        await first.sweep(new Date(at));
      }
      const other = scheduleWindows(t.adapter, [second]);
      await other.sweep(new Date("2026-09-01T11:40:00.000Z"));
      await other.sweep(new Date("2026-11-04T12:40:00.000Z"));

      // Two passes an hour apart, each a fresh process with room for two:
      // the first takes 10:00 and 11:00, the second 11:30 and 12:00.
      const both = () => scheduleWindows(t.adapter, [hourly(), second]);
      expect(await both().prune(new Date("2026-10-05T00:00:00.000Z"), 2)).toBe(
        2
      );
      expect(await both().prune(new Date("2026-10-05T01:00:00.000Z"), 2)).toBe(
        2
      );
      const left = await t.adapter.select<WindowRow>("nextly_schedule_windows");
      expect(left.map(row => iso(row.windowAt)).sort()).toEqual([
        "2026-09-01T13:00:00.000Z",
        "2026-11-04T12:00:00.000Z",
        "2026-11-04T12:30:00.000Z",
      ]);
    });

    it("prunes as many as the bound allows when the oldest window is a schedule's latest, kept", async () => {
      const t = await boot(dialect, "0 * * * *");
      const monthly = defined("@monthly", "monthly");
      // The monthly schedule's only window, 1 August, is the oldest of all.
      await scheduleWindows(t.adapter, [monthly]).sweep(
        new Date("2026-08-10T00:00:00.000Z")
      );
      const windows = scheduleWindows(t.adapter, [hourly()]);
      for (const at of [
        "2026-09-01T10:05:00.000Z",
        "2026-09-01T11:05:00.000Z",
        "2026-11-04T12:05:00.000Z",
      ]) {
        await windows.sweep(new Date(at));
      }
      expect(
        await scheduleWindows(t.adapter, [monthly, hourly()]).prune(
          new Date("2026-10-05T00:00:00.000Z"),
          1
        )
      ).toBe(1);
      const left = await t.adapter.select<WindowRow>("nextly_schedule_windows");
      expect(left.map(row => iso(row.windowAt)).sort()).toEqual([
        "2026-08-01T00:00:00.000Z",
        "2026-09-01T11:00:00.000Z",
        "2026-11-04T12:00:00.000Z",
      ]);
    });

    it("a runner whose clock is behind claims no window older than one recorded", async () => {
      const t = await boot(dialect, "0 * * * *");
      const windows = scheduleWindows(t.adapter, [hourly()]);
      await windows.sweep(new Date("2026-11-05T10:30:00.000Z"));
      await windows.sweep(new Date("2026-11-05T12:05:00.000Z"));
      expect(await jobsOf(t)).toHaveLength(1);
      // 11:00 was skipped while nothing ran; a clock an hour behind must not
      // run it now that 12:00 has been.
      await windows.sweep(new Date("2026-11-05T11:05:00.000Z"));
      expect(await jobsOf(t)).toHaveLength(1);
    });

    it("a failed enqueue after the claim leaves the window to the next sweep, which enqueues it", async () => {
      const t = await boot(dialect, "0 * * * *");
      await pass(t, "2026-11-05T10:30:00.000Z");
      const failing = scheduleWindows(t.adapter, [hourly()], {
        enqueue: () => Promise.reject(new Error("the runner stopped")),
      });
      await failing.sweep(new Date("2026-11-05T11:05:00.000Z"));
      // The claim went with the enqueue: nothing of 11:00 is recorded.
      expect((await windowsOf(t)).map(row => iso(row.windowAt)).sort()).toEqual(
        ["2026-11-05T10:00:00.000Z"]
      );
      expect(await jobsOf(t)).toHaveLength(0);

      await pass(t, "2026-11-05T11:10:00.000Z");
      expect(await jobsOf(t)).toHaveLength(1);
    });

    it("a window whose job was enqueued is not enqueued again, before or after that job finishes", async () => {
      const t = await boot(dialect, "0 * * * *");
      await pass(t, "2026-11-05T10:30:00.000Z");
      // The sweep commits, and the runner stops before running anything.
      await scheduleWindows(t.adapter, [hourly()]).sweep(
        new Date("2026-11-05T11:05:00.000Z")
      );
      expect(await jobsOf(t)).toHaveLength(1);
      expect((await jobsOf(t))[0].state).toBe("pending");

      // A later pass finds the window had: it runs the job and adds none.
      await pass(t, "2026-11-05T11:20:00.000Z");
      const jobs = await jobsOf(t);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].state).toBe("done");
      await pass(t, "2026-11-05T11:50:00.000Z");
      expect(await jobsOf(t)).toHaveLength(1);
    });

    it("a yearly schedule first seen after its window isn't enqueued for that window; it's enqueued at the next one", async () => {
      const t = await boot(dialect, "@yearly");
      await pass(t, "2026-11-05T10:00:00.000Z");
      await pass(t, "2026-12-31T23:59:00.000Z");
      expect(await jobsOf(t)).toHaveLength(0);

      await pass(t, "2027-01-01T00:05:00.000Z");
      expect(await jobsOf(t)).toHaveLength(1);
    });

    it("a monthly schedule first seen weeks after its window waits for the next", async () => {
      const t = await boot(dialect, "@monthly");
      await pass(t, "2026-11-20T10:00:00.000Z");
      expect(await jobsOf(t)).toHaveLength(0);
      await pass(t, "2026-12-01T00:01:00.000Z");
      expect(await jobsOf(t)).toHaveLength(1);
    });

    it("prunes windows older than the retention, keeps recent ones and each schedule's latest window", async () => {
      const t = await boot(dialect, "0 * * * *");
      const windows = scheduleWindows(t.adapter, [hourly()]);
      for (const at of [
        "2026-09-01T10:30:00.000Z",
        "2026-09-01T11:30:00.000Z",
        "2026-11-04T12:30:00.000Z",
      ]) {
        await windows.sweep(new Date(at));
      }
      // One row per pass at most: the bound holds.
      expect(await windows.prune(new Date("2026-10-05T00:00:00.000Z"), 1)).toBe(
        1
      );
      expect(await windowsOf(t)).toHaveLength(2);
      await windows.prune(new Date("2026-10-05T00:00:00.000Z"), 100);
      expect((await windowsOf(t)).map(row => iso(row.windowAt)).sort()).toEqual(
        ["2026-11-04T12:00:00.000Z"]
      );

      // A schedule whose only window is older than the retention keeps it,
      // so that window is not enqueued again.
      const monthly: CollectedSchedule = {
        ...hourly(),
        key: `${PLUGIN}:monthly`,
        slug: "monthly",
        cron: parseCron("@monthly"),
      };
      const monthlyWindows = scheduleWindows(t.adapter, [monthly]);
      await monthlyWindows.sweep(new Date("2026-08-10T00:00:00.000Z"));
      await monthlyWindows.sweep(new Date("2026-09-10T00:00:00.000Z"));
      // Another declared schedule, its latest window at the edge of the
      // monthly one's prune.
      const otherSchedule: CollectedSchedule = {
        ...monthly,
        key: `${PLUGIN}:other`,
        slug: "other",
      };
      const other = scheduleWindows(t.adapter, [otherSchedule]);
      await other.sweep(new Date("2026-07-10T00:00:00.000Z"));
      await other.sweep(new Date("2026-08-10T00:00:00.000Z"));
      await scheduleWindows(t.adapter, [monthly, otherSchedule]).prune(
        new Date("2026-10-15T00:00:00.000Z"),
        100
      );
      const kept = await t.adapter.select<WindowRow>(
        "nextly_schedule_windows",
        {
          where: {
            and: [
              { column: "scheduleKey", op: "=", value: `${PLUGIN}:monthly` },
            ],
          },
        }
      );
      expect(kept.map(row => iso(row.windowAt))).toEqual([
        "2026-09-01T00:00:00.000Z",
      ]);
      // Each schedule is pruned by its own latest window: the monthly
      // schedule's prune reaching 1 August did not take the other's latest.
      const others = await t.adapter.select<WindowRow>(
        "nextly_schedule_windows",
        {
          where: {
            and: [{ column: "scheduleKey", op: "=", value: `${PLUGIN}:other` }],
          },
        }
      );
      expect(others.map(row => iso(row.windowAt)).sort()).toEqual([
        "2026-08-01T00:00:00.000Z",
      ]);
      const before = (await jobsOf(t)).length;
      await monthlyWindows.sweep(new Date("2026-09-30T00:00:00.000Z"));
      expect(await jobsOf(t)).toHaveLength(before);
    });
  }
);
