/**
 * A plugin running one of its own sweeps now: what it may run, and how long.
 *
 * The property that matters is the refusal. A plugin's context is handed to
 * its code and nothing else, so "run a sweep now" must mean the plugin's OWN
 * sweeps: one that could name another plugin's, or core's release drain,
 * would let any plugin force work it has no stake in, as often as it likes.
 *
 * @module plugins/jobs/__tests__/plugin-jobs.test
 */
import { describe, expect, it, vi } from "vitest";

import { JobRegistry, defineJob } from "../../../domains/jobs/job-registry";
import type { RunJobsResult } from "../../../domains/jobs/run-jobs";
import { NextlyError } from "../../../errors/nextly-error";
import { PLUGIN_SWEEP_NOW_MAX_MS, pluginJobsNamespace } from "../plugin-jobs";

const SWEEP = defineJob({
  slug: "acme:reindex",
  sweep: true,
  handler: async () => undefined,
});
const ONE_OFF = defineJob({
  slug: "acme:export",
  handler: async () => undefined,
});

/**
 * An installation's registry as the boot fills it: acme's own sweep and
 * one-off job, another plugin's sweep, and core's release drain, which no
 * plugin declared.
 */
function registry(): JobRegistry {
  const jobs = new JobRegistry();
  jobs.register(SWEEP, { plugin: "acme" });
  jobs.register(ONE_OFF, { plugin: "acme" });
  jobs.register(
    defineJob({ slug: "other:reindex", sweep: true, handler: async () => {} }),
    { plugin: "other" }
  );
  jobs.register(
    defineJob({ slug: "releases:drain", sweep: true, handler: async () => {} })
  );
  return jobs;
}

/** The host a context offers, over that registry and a recording run. */
const hostOf = (run: (slug: string, ms: number) => Promise<RunJobsResult>) => {
  const jobs = registry();
  return { registry: () => jobs, run };
};

const ran = { claimed: 1, done: 1, failed: 0, retried: 0, unrecorded: 0 };

describe("running a plugin's own sweep now", () => {
  it("runs a sweep the plugin contributes, bounded, and says it ran", async () => {
    const run = vi.fn(async () => ran);
    const jobs = pluginJobsNamespace("acme", hostOf(run));

    await expect(
      jobs.runSweepNow("acme:reindex", { maxDurationMs: 5_000 })
    ).resolves.toEqual({ ran: true });
    expect(run).toHaveBeenCalledWith("acme:reindex", 5_000);
  });

  it("says it did not run when another runner holds the sweep", async () => {
    const run = vi.fn(async () => ({ ...ran, claimed: 0, done: 0 }));
    const jobs = pluginJobsNamespace("acme", hostOf(run));

    await expect(jobs.runSweepNow("acme:reindex")).resolves.toEqual({
      ran: false,
    });
  });

  it("matches the slug as the registry keys it, trimmed", async () => {
    const run = vi.fn(async () => ran);
    const jobs = pluginJobsNamespace("acme", hostOf(run));

    await jobs.runSweepNow("  acme:reindex ");
    expect(run).toHaveBeenCalledWith("acme:reindex", PLUGIN_SWEEP_NOW_MAX_MS);
  });

  it("holds a longer budget to the most a request may spend", async () => {
    const run = vi.fn(async () => ran);
    const jobs = pluginJobsNamespace("acme", hostOf(run));

    await jobs.runSweepNow("acme:reindex", { maxDurationMs: 600_000 });
    expect(run).toHaveBeenCalledWith("acme:reindex", PLUGIN_SWEEP_NOW_MAX_MS);
  });

  it.each([
    ["not a number", Number.NaN],
    ["negative", -1],
  ])("refuses a budget that is %s, running nothing", async (_name, budget) => {
    // A NaN slips through a clamp (Math.min answers NaN), and a runner told
    // to stop at NaN never stops: the ceiling must hold for every input.
    const run = vi.fn(async () => ran);
    const jobs = pluginJobsNamespace("acme", hostOf(run));

    const refusal = await jobs
      .runSweepNow("acme:reindex", { maxDurationMs: budget })
      .catch((error: unknown) => error);
    expect(NextlyError.is(refusal)).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it("holds an endless budget to the most a request may spend", async () => {
    const run = vi.fn(async () => ran);
    const jobs = pluginJobsNamespace("acme", hostOf(run));

    await jobs.runSweepNow("acme:reindex", {
      maxDurationMs: Number.POSITIVE_INFINITY,
    });
    expect(run).toHaveBeenCalledWith("acme:reindex", PLUGIN_SWEEP_NOW_MAX_MS);
  });

  it.each([
    ["another plugin's sweep", "other:reindex"],
    ["core's release drain", "releases:drain"],
    ["its own job that is not a sweep", "acme:export"],
  ])("refuses %s, running nothing", async (_name, slug) => {
    const run = vi.fn(async () => ran);
    const jobs = pluginJobsNamespace("acme", hostOf(run));

    const refusal = await jobs
      .runSweepNow(slug)
      .catch((error: unknown) => error);
    expect(NextlyError.is(refusal) && refusal.code).toBe("FORBIDDEN");
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses everything for a context built for no plugin", async () => {
    const run = vi.fn(async () => ran);
    const jobs = pluginJobsNamespace(undefined, hostOf(run));

    await expect(jobs.runSweepNow("acme:reindex")).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});
