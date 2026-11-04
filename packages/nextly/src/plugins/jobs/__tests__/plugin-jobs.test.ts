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

import { defineJob } from "../../../domains/jobs/job-registry";
import { NextlyError } from "../../../errors/nextly-error";
import type { PluginDefinition } from "../../plugin-context";
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

const acme = {
  name: "acme",
  contributes: { jobs: [SWEEP, ONE_OFF] },
} as unknown as PluginDefinition;

const ran = { claimed: 1, done: 1, failed: 0, retried: 0, unrecorded: 0 };

describe("running a plugin's own sweep now", () => {
  it("runs a sweep the plugin contributes, bounded, and says it ran", async () => {
    const run = vi.fn(async () => ran);
    const jobs = pluginJobsNamespace(acme, { run });

    await expect(
      jobs.runSweepNow("acme:reindex", { maxDurationMs: 5_000 })
    ).resolves.toEqual({ ran: true });
    expect(run).toHaveBeenCalledWith("acme:reindex", 5_000);
  });

  it("says it did not run when another runner holds the sweep", async () => {
    const run = vi.fn(async () => ({ ...ran, claimed: 0, done: 0 }));
    const jobs = pluginJobsNamespace(acme, { run });

    await expect(jobs.runSweepNow("acme:reindex")).resolves.toEqual({
      ran: false,
    });
  });

  it("matches the slug as the registry keys it, trimmed", async () => {
    const run = vi.fn(async () => ran);
    const jobs = pluginJobsNamespace(acme, { run });

    await jobs.runSweepNow("  acme:reindex ");
    expect(run).toHaveBeenCalledWith("acme:reindex", PLUGIN_SWEEP_NOW_MAX_MS);
  });

  it("holds a longer budget to the most a request may spend", async () => {
    const run = vi.fn(async () => ran);
    const jobs = pluginJobsNamespace(acme, { run });

    await jobs.runSweepNow("acme:reindex", { maxDurationMs: 600_000 });
    expect(run).toHaveBeenCalledWith("acme:reindex", PLUGIN_SWEEP_NOW_MAX_MS);
  });

  it.each([
    ["another plugin's sweep", "other:reindex"],
    ["core's release drain", "releases:drain"],
    ["its own job that is not a sweep", "acme:export"],
  ])("refuses %s, running nothing", async (_name, slug) => {
    const run = vi.fn(async () => ran);
    const jobs = pluginJobsNamespace(acme, { run });

    const refusal = await jobs
      .runSweepNow(slug)
      .catch((error: unknown) => error);
    expect(NextlyError.is(refusal) && refusal.code).toBe("FORBIDDEN");
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses everything for a context built for no plugin", async () => {
    const run = vi.fn(async () => ran);
    const jobs = pluginJobsNamespace(undefined, { run });

    await expect(jobs.runSweepNow("acme:reindex")).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});
