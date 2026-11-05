/**
 * The schedules plugins declare, collected for the jobs pass: each one read
 * and checked as the installation starts, and refused there, naming the
 * plugin, when it cannot run.
 */
import { describe, expect, it } from "vitest";

import { defineJob } from "../../jobs/job-registry";
import { NextlyError } from "../../../errors";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import type { CollectedJob } from "../../../plugins/jobs/collect-jobs";
import { collectSchedules } from "../collect-schedules";

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

/** The refusal of collecting `plugins`, or a failure saying there was none. */
function refusal(...plugins: PluginDefinition[]): NextlyError {
  try {
    collectSchedules(plugins, jobsOf(...plugins));
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
    const [collected] = collectSchedules([p], jobsOf(p));
    expect(collected).toMatchObject({
      key: "@acme/plugin:tick",
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
    expect(collectSchedules([p], jobsOf(p))[0]).toMatchObject({
      timeZone: "UTC",
      input: { a: 1 },
    });
  });

  it("collects nothing from a disabled plugin", () => {
    const p = plugin([{ slug: "tick", cron: "nonsense", job: "acme:tick" }], {
      enabled: false,
    });
    expect(collectSchedules([p], jobsOf(p))).toEqual([]);
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
      "input that is not an object",
      { slug: "tick", cron: "@daily", job: "acme:tick", input: [1, 2] },
    ],
  ])("refuses to start on %s, naming the plugin", (_case, schedule) => {
    const error = refusal(plugin([schedule]));
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toContain("@acme/plugin");
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
      collectSchedules([p, other], jobsOf(p, other));
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

  it("leaves a schedule in the earlier shape unexecuted, as before", () => {
    const p = plugin([{ name: "acme.old", schedule: "0 * * * *" }]);
    expect(collectSchedules([p], jobsOf(p))).toEqual([]);
  });
});
