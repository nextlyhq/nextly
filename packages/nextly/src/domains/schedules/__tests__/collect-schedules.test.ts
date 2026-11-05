/**
 * The schedules plugins declare, collected for the jobs pass: each one read
 * and checked as the installation starts, and refused there, naming the
 * plugin, when it cannot run.
 */
import { describe, expect, it } from "vitest";

import { defineJob, type JobContext } from "../../jobs/job-registry";
import { NextlyError } from "../../../errors";
import type {
  PluginContext,
  PluginDefinition,
} from "../../../plugins/plugin-context";
import type { CollectedJob } from "../../../plugins/jobs/collect-jobs";
import {
  collectSchedules,
  scheduleKeyOf,
  type EarlierScheduleOptions,
} from "../collect-schedules";
import { parseCron } from "../cron";

const tick = defineJob({ slug: "acme:tick", handler: async () => {} });

function plugin(
  schedules: unknown[],
  overrides: Partial<PluginDefinition> = {}
): PluginDefinition {
  return {
    name: "@acme/plugin",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      jobs: [tick],
      schedules: schedules as NonNullable<
        PluginDefinition["contributes"]
      >["schedules"],
    },
    ...overrides,
  };
}

function jobsOf(...plugins: PluginDefinition[]): CollectedJob[] {
  return plugins.flatMap(p =>
    (p.contributes?.jobs ?? []).map(definition => ({
      definition,
      owner: p.name,
      plugin: p.name,
    }))
  );
}

/** No notice looked at, and no plugin started. */
const quiet: EarlierScheduleOptions = {
  notice: () => {},
  contextOf: async () => undefined,
};

/** The schedules collected from `plugins`. */
function collect(plugins: PluginDefinition[], jobs: CollectedJob[]) {
  return collectSchedules(plugins, jobs, quiet).schedules;
}

/**
 * `p`'s schedules and earlier-shape jobs, with the notices said, its handlers
 * given `context` as the plugin's started one.
 */
function earlier(p: PluginDefinition, context?: PluginContext) {
  const notices: string[] = [];
  const collected = collectSchedules([p], jobsOf(p), {
    notice: message => notices.push(message),
    contextOf: async () => context,
  });
  return { ...collected, notices };
}

/** A job's context, for running a handler outside the runner. */
const jobContext = { jobId: "job-1", attempt: 1 } as unknown as JobContext;

/** The refusal of collecting `plugins`, or a failure saying there was none. */
function refusal(...plugins: PluginDefinition[]): NextlyError {
  try {
    collect(plugins, jobsOf(...plugins));
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
  throw new Error("expected the schedules to be refused");
}

describe("collecting plugin schedules", () => {
  it("collects a schedule, keyed by its plugin, read in its time zone", () => {
    const p = plugin([
      {
        slug: "tick",
        cron: "0 9 * * *",
        job: "acme:tick",
        tz: "Europe/Berlin",
      },
    ]);
    const [collected] = collect([p], jobsOf(p));
    // The plugin, the slug and a short tag of the definition.
    expect(collected.key).toMatch(/^@acme\/plugin:tick@[\w-]{12}$/);
    expect(collected).toMatchObject({
      plugin: "@acme/plugin",
      slug: "tick",
      job: "acme:tick",
      timeZone: "Europe/Berlin",
      input: {},
    });
    expect(collected.cron.source).toBe("0 9 * * *");
  });

  it("reads UTC when a schedule names no time zone, and keeps its input", () => {
    const p = plugin([
      { slug: "tick", cron: "@hourly", job: "acme:tick", input: { a: 1 } },
    ]);
    expect(collect([p], jobsOf(p))[0]).toMatchObject({
      timeZone: "UTC",
      input: { a: 1 },
    });
  });

  it("collects nothing from a disabled plugin", () => {
    const p = plugin([{ slug: "tick", cron: "nonsense", job: "acme:tick" }], {
      enabled: false,
    });
    expect(collect([p], jobsOf(p))).toEqual([]);
  });

  it.each([
    ["an invalid cron", { slug: "tick", cron: "61 * * * *", job: "acme:tick" }],
    [
      "an unknown time zone",
      { slug: "tick", cron: "@daily", job: "acme:tick", tz: "Mars/Olympus" },
    ],
    ["an unknown job", { slug: "tick", cron: "@daily", job: "acme:nothing" }],
    ["an empty slug", { slug: "", cron: "@daily", job: "acme:tick" }],
    [
      "a slug with capitals",
      { slug: "Tick", cron: "@daily", job: "acme:tick" },
    ],
    ["a slug with a colon", { slug: "a:b", cron: "@daily", job: "acme:tick" }],
    ["a blank job slug", { slug: "tick", cron: "@daily", job: "   " }],
    [
      "input that is not an object",
      { slug: "tick", cron: "@daily", job: "acme:tick", input: [1, 2] },
    ],
    [
      "input holding a date",
      {
        slug: "tick",
        cron: "@daily",
        job: "acme:tick",
        input: { at: new Date() },
      },
    ],
    [
      "input holding a bigint",
      { slug: "tick", cron: "@daily", job: "acme:tick", input: { n: 1n } },
    ],
    [
      "input holding a map",
      {
        slug: "tick",
        cron: "@daily",
        job: "acme:tick",
        input: { m: new Map() },
      },
    ],
  ])("refuses to start on %s, naming the plugin", (_case, schedule) => {
    const error = refusal(plugin([schedule]));
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toContain("@acme/plugin");
  });

  it("refuses a key that fits in characters but not in the bytes stored, naming the plugin", () => {
    // 100 two-byte characters: under 191 characters, over 191 bytes.
    const name = "é".repeat(100);
    const error = refusal(
      plugin([{ slug: "tick", cron: "@daily", job: "acme:tick" }], {
        name,
        contributes: {
          jobs: [tick],
          schedules: [{ slug: "tick", cron: "@daily", job: "acme:tick" }],
        },
      })
    );
    expect(error.message).toContain(name);
    expect(error.message).toContain("bytes");
  });

  it("refuses a key with a control character, which PostgreSQL cannot store, naming the plugin", () => {
    const name = "@acme/plug\u0000in";
    const error = refusal(
      plugin([{ slug: "tick", cron: "@daily", job: "acme:tick" }], {
        name,
        contributes: {
          jobs: [tick],
          schedules: [{ slug: "tick", cron: "@daily", job: "acme:tick" }],
        },
      })
    );
    expect(error.message).toContain(name);
    expect(error.message).toContain("control character");
  });

  it("refuses to start on a duplicate slug, naming the plugin", () => {
    const error = refusal(
      plugin([
        { slug: "tick", cron: "@daily", job: "acme:tick" },
        { slug: "tick", cron: "@hourly", job: "acme:tick" },
      ])
    );
    expect(error.message).toContain("@acme/plugin");
    expect(error.message).toContain('"tick"');
  });

  it("refuses a schedule running another plugin's job, naming the plugin", () => {
    const other = plugin([], {
      name: "@other/plugin",
      contributes: {
        jobs: [defineJob({ slug: "other:job", handler: async () => {} })],
      },
    });
    const p = plugin([{ slug: "tick", cron: "@daily", job: "other:job" }]);
    let thrown: unknown;
    try {
      collect([p, other], jobsOf(p, other));
    } catch (error) {
      thrown = error;
    }
    expect(NextlyError.is(thrown)).toBe(true);
    expect((thrown as NextlyError).message).toContain("@acme/plugin");
  });

  it("refuses an entry in neither shape, such as a misspelled cron, naming the plugin", () => {
    const error = refusal(
      plugin([{ slug: "tick", crons: "@daily", job: "acme:tick" }])
    );
    expect(error.message).toContain("@acme/plugin");
    expect(error.message).toContain("cron");
  });

  it("keys a schedule by its definition: the cron and the time zone change it, spacing and alias spelling do not", () => {
    const keyOf = (cron: string, tz?: string) => {
      const p = plugin([
        { slug: "tick", cron, job: "acme:tick", ...(tz ? { tz } : {}) },
      ]);
      return collect([p], jobsOf(p))[0].key;
    };
    const daily = keyOf("@daily");
    expect(keyOf("0 0 * * *")).toBe(daily);
    expect(keyOf("  0   0 * *  * ")).toBe(daily);
    expect(keyOf("@midnight")).toBe(daily);
    expect(keyOf("0 0 * * *", "UTC")).toBe(daily);
    expect(keyOf("0 1 * * *")).not.toBe(daily);
    expect(keyOf("@daily", "Europe/Berlin")).not.toBe(daily);
  });

  it("refuses two plugins whose schedules have one key, naming the second", () => {
    const first = plugin([{ slug: "tick", cron: "@daily", job: "acme:tick" }]);
    const second = plugin([{ slug: "tick", cron: "@daily", job: "acme:tick" }]);
    let thrown: unknown;
    try {
      collect([first, second], jobsOf(first, second));
    } catch (error) {
      thrown = error;
    }
    expect(NextlyError.is(thrown)).toBe(true);
    expect((thrown as NextlyError).message).toContain("@acme/plugin");
    expect((thrown as NextlyError).message).toContain("same key");
  });

  it("maps the earlier shape, with a deprecation notice once per schedule", async () => {
    const ran: unknown[] = [];
    const context = { started: "@acme/plugin" } as unknown as PluginContext;
    const p = plugin([
      {
        name: "acme.sitemap",
        schedule: "0 * * * *",
        handler: (ctx: PluginContext) => {
          ran.push(ctx);
        },
      },
      { name: "acme.digest", schedule: "@daily", handler: () => {} },
    ]);
    const first = earlier(p, context);
    expect(
      first.schedules.map(schedule => [schedule.slug, schedule.job])
    ).toEqual([
      ["acme.sitemap", "@acme/plugin:schedule:acme.sitemap"],
      ["acme.digest", "@acme/plugin:schedule:acme.digest"],
    ]);
    expect(first.schedules[0].cron).toEqual(parseCron("0 * * * *"));
    expect(first.jobs.map(job => [job.definition.slug, job.plugin])).toEqual([
      ["@acme/plugin:schedule:acme.sitemap", "@acme/plugin"],
      ["@acme/plugin:schedule:acme.digest", "@acme/plugin"],
    ]);
    expect(first.notices).toHaveLength(2);
    expect(first.notices[0]).toContain('"acme.sitemap"');
    expect(first.notices[0]).toContain("deprecated");
    expect(first.notices[1]).toContain('"acme.digest"');

    // Its handler runs as the job, given the plugin's started context.
    await first.jobs[0].definition.handler(
      { window: "2026-11-05T11:00:00.000Z" } as never,
      jobContext
    );
    expect(ran).toEqual([context]);

    // Collected again, as a reload does: nothing more is said.
    expect(earlier(p, context).notices).toEqual([]);
  });

  it("an earlier-shape handler whose plugin was not started fails its job, rather than running without a context", async () => {
    const p = plugin([
      { name: "acme.unstarted", schedule: "@daily", handler: () => {} },
    ]);
    const [job] = earlier(p).jobs;
    await expect(
      job.definition.handler({} as never, jobContext)
    ).rejects.toThrow();
  });

  it("maps an interval in milliseconds that fits a cron step (60000 → every minute, 900000 → every 15 minutes, 7200000 → every 2 hours)", () => {
    for (const [ms, cron] of [
      [60_000, "* * * * *"],
      [900_000, "*/15 * * * *"],
      [7_200_000, "0 */2 * * *"],
      [3_600_000, "0 * * * *"],
      [86_400_000, "0 0 * * *"],
    ] as const) {
      const slug = `acme.every-${ms}`;
      const p = plugin([{ name: slug, schedule: ms, handler: () => {} }]);
      const [schedule] = earlier(p).schedules;
      // Keyed as the cron written out would be: one definition.
      expect(schedule.key).toBe(
        scheduleKeyOf("@acme/plugin", slug, parseCron(cron), "UTC")
      );
    }
  });

  it("leaves an earlier-shape schedule that cannot be mapped unexecuted, says so, and starts", () => {
    const p = plugin([
      { name: "acme.seven", schedule: 420_000, handler: () => {} },
      { name: "acme.ninety", schedule: 90_000, handler: () => {} },
      { name: "acme.bad", schedule: "every day", handler: () => {} },
      { name: "acme.none", schedule: "@daily" },
      { name: "Acme Old", schedule: "@daily", handler: () => {} },
    ]);
    const { schedules, jobs, notices } = earlier(p);
    expect(schedules).toEqual([]);
    expect(jobs).toEqual([]);
    expect(notices).toHaveLength(5);
    for (const notice of notices) {
      expect(notice).toContain("@acme/plugin");
      expect(notice).toContain("is not run");
    }
    expect(notices[0]).toContain("420000 ms");
    expect(notices[1]).toContain("90000 ms");
    expect(notices[2]).toContain('"acme.bad"');
    expect(notices[2]).toContain("five fields");
    expect(notices[3]).toContain("no handler");
    expect(notices[4]).toContain("slug");
  });

  it("leaves an interval that is no positive whole number of milliseconds a cron step keeps unexecuted, and says so", () => {
    const intervals = [0, -60_000, Number.NaN, 5_400_000, 30_000];
    const p = plugin(
      intervals.map((ms, index) => ({
        name: `acme.interval-${index}`,
        schedule: ms,
        handler: () => {},
      }))
    );
    const { schedules, notices } = earlier(p);
    expect(schedules).toEqual([]);
    expect(notices).toHaveLength(intervals.length);
    for (const notice of notices) expect(notice).toContain("is not run");
  });

  it("an earlier-shape schedule declared before a current-shape one with its slug is not run, and the current one is", () => {
    const p = plugin([
      { name: "acme.first", schedule: "@hourly", handler: () => {} },
      { slug: "acme.first", cron: "@daily", job: "acme:tick" },
    ]);
    const { schedules, jobs, notices } = earlier(p);
    expect(schedules.map(schedule => [schedule.slug, schedule.job])).toEqual([
      ["acme.first", "acme:tick"],
    ]);
    expect(jobs).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("is not run");
    expect(notices[0]).toContain("same slug");
  });

  it("an earlier-shape schedule whose name is not a string is not run, and the start goes on", () => {
    const p = plugin([
      { name: 123, schedule: "@daily", handler: () => {} },
      { name: undefined, schedule: "@hourly", handler: () => {} },
    ]);
    const { schedules, jobs, notices } = earlier(p);
    expect(schedules).toEqual([]);
    expect(jobs).toEqual([]);
    expect(notices.length).toBeGreaterThan(0);
    for (const notice of notices) {
      expect(notice).toContain("is not run");
      expect(notice).toContain("name");
    }
  });

  it("an earlier-shape schedule whose fields cannot be read is not run, and the start goes on", () => {
    const unreadable = {
      name: "acme.unreadable",
      get schedule(): string {
        throw new Error("no schedule here");
      },
      handler: () => {},
    };
    const p = plugin([unreadable]);
    const { schedules, notices } = earlier(p);
    expect(schedules).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('"acme.unreadable"');
    expect(notices[0]).toContain("is not run");
  });

  it("two earlier-shape schedules with one name: the first runs, and the second is told it is not run", () => {
    const p = plugin([
      { name: "acme.same", schedule: "@hourly", handler: () => {} },
      { name: "acme.same", schedule: "@daily", handler: () => {} },
    ]);
    const { schedules, notices } = earlier(p);
    expect(schedules).toHaveLength(1);
    expect(notices).toHaveLength(2);
    expect(notices[0]).toContain("deprecated");
    expect(notices[1]).toContain("is not run");
  });

  it("maps an earlier-shape name with spaces around it as the name without them", () => {
    const p = plugin([
      { name: " acme.spaced ", schedule: "@daily", handler: () => {} },
    ]);
    const { schedules, jobs } = earlier(p);
    expect(schedules.map(schedule => [schedule.slug, schedule.job])).toEqual([
      ["acme.spaced", "@acme/plugin:schedule:acme.spaced"],
    ]);
    expect(jobs.map(job => job.definition.slug)).toEqual([
      "@acme/plugin:schedule:acme.spaced",
    ]);
  });

  it("an earlier-shape name with spaces around it whose job the plugin already declares is not run, and the start goes on", () => {
    const taken = defineJob({
      slug: "@acme/plugin:schedule:acme.taken-spaced",
      handler: async () => {},
    });
    const earlierTask = {
      name: "acme.taken-spaced ",
      schedule: "@daily",
      handler: () => {},
    };
    const p = plugin([earlierTask], {
      contributes: { jobs: [tick, taken], schedules: [earlierTask] },
    });
    const { schedules, jobs, notices } = earlier(p);
    expect(schedules).toEqual([]);
    expect(jobs).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("declared already");
  });

  it("an earlier-shape schedule whose job the plugin already declares is not run, and the start goes on", () => {
    const taken = defineJob({
      slug: "@acme/plugin:schedule:acme.taken",
      handler: async () => {},
    });
    const earlierTask = {
      name: "acme.taken",
      schedule: "@daily",
      handler: () => {},
    };
    const p = plugin([earlierTask], {
      contributes: {
        jobs: [tick, taken],
        schedules: [earlierTask],
      },
    });
    const { schedules, jobs, notices } = earlier(p);
    expect(schedules).toEqual([]);
    expect(jobs).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("declared already");
  });

  it("an earlier-shape schedule whose slug another of the plugin's schedules has is not run, and the start goes on", () => {
    const p = plugin([
      { slug: "acme.twice", cron: "@daily", job: "acme:tick" },
      { name: "acme.twice", schedule: "@hourly", handler: () => {} },
    ]);
    const { schedules, jobs, notices } = earlier(p);
    expect(schedules.map(schedule => schedule.slug)).toEqual(["acme.twice"]);
    expect(schedules[0].job).toBe("acme:tick");
    expect(jobs).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("same slug");
  });
});
