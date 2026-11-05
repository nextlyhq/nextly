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
import type { CollectedSchedule } from "../collect-schedules";
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
      and: [{ column: "scheduleKey", op: "=", value: `${PLUGIN}:tick` }],
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
function hourly(): CollectedSchedule {
  return {
    key: `${PLUGIN}:tick`,
    plugin: PLUGIN,
    slug: "tick",
    cron: parseCron("0 * * * *"),
    timeZone: "UTC",
    job: JOB,
    input: {},
  };
}

describe.each(getConfiguredTestDialects())(
  "a plugin's schedule runs once per window (%s)",
  dialect => {
    it("refuses to start with a schedule that cannot run, naming the plugin", async () => {
      await expect(boot(dialect, "every hour")).rejects.toThrow(PLUGIN);
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
      await monthlyWindows.prune(new Date("2026-10-15T00:00:00.000Z"), 100);
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
      const before = (await jobsOf(t)).length;
      await monthlyWindows.sweep(new Date("2026-09-30T00:00:00.000Z"));
      expect(await jobsOf(t)).toHaveLength(before);
    });
  }
);
