/**
 * `ctx.services.jobs` as a plugin sees it: queue work, and run one of its OWN
 * sweeps now.
 *
 * A sweep runs when something drains the queue: a scheduler calling the jobs
 * route on an interval. A site with no scheduler never runs one, and a plugin
 * whose answer depends on a sweep finishing (a usage index filled in for
 * existing content) is stuck saying "not yet" for ever. Running the sweep from
 * a request the author made is the way out, and core already does it for its
 * own release drain ("Publish now").
 *
 * ## Why only the plugin's own sweeps
 *
 * The context is handed to the plugin's code, and nothing else stands between
 * that code and this method. Without the ownership check any plugin could run
 * any sweep, another plugin's or core's, as often as its routes are called.
 * Ownership is read from the plugin's own `contributes.jobs`, the list the
 * registry was folded from, so it is the same answer the registry gives about
 * who declared a slug: slugs are unique across the app and every plugin, which
 * `collectJobs` enforces at boot.
 *
 * ## Why bounded here
 *
 * It runs inside the request that asked, and a serverless platform kills a
 * request that overruns. The budget is the jobs route's own, so a sweep run
 * this way can never spend longer than a scheduled pass would. The sweep's
 * queue row is durable: a pass that stops early has lost nothing, and the next
 * pass, scheduled or asked for, carries on.
 *
 * @module plugins/jobs/plugin-jobs
 */
import { runDetachedFromRequest } from "../../auth/caller-scope";
import { container } from "../../di/container";
import {
  createJobsNamespace,
  type JobsNamespace,
} from "../../direct-api/namespaces/jobs";
import {
  normalizeJobSlug,
  type JobRegistry,
} from "../../domains/jobs/job-registry";
import {
  runSweepNow,
  type JobsPassDatabase,
} from "../../domains/jobs/jobs-runner";
import type { RunJobsResult } from "../../domains/jobs/run-jobs";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../plugin-context";

/**
 * The most a sweep run from a request may spend starting work: the budget the
 * jobs route gives one triggered pass, for the same reason.
 */
export const PLUGIN_SWEEP_NOW_MAX_MS = 20_000;

/**
 * @experimental A plugin's jobs: {@link JobsNamespace}, plus running one of
 * its own sweeps now.
 */
export interface PluginJobsNamespace extends JobsNamespace {
  /**
   * Run one of this plugin's sweeps now, from the request that asked, rather
   * than waiting for a scheduler that may not exist.
   *
   * Refused (`FORBIDDEN`) for a slug that is not a sweep this plugin
   * contributes. `maxDurationMs` bounds how long it keeps STARTING work, at
   * most {@link PLUGIN_SWEEP_NOW_MAX_MS}; a handler already running is awaited,
   * so a sweep should check its deadline as it goes. `ran` is false when
   * another runner holds the sweep: that runner is doing the work.
   *
   * Runs as nobody, as a scheduled pass does, never as the request's caller.
   */
  runSweepNow(
    slug: string,
    options?: { maxDurationMs?: number }
  ): Promise<{ ran: boolean }>;
}

/** How a sweep is run, injected so the ownership rule is testable alone. */
export interface PluginSweepRunner {
  run(slug: string, maxDurationMs: number): Promise<RunJobsResult>;
}

/**
 * The runner a booted installation has: its adapter and its one job
 * registry, run outside the request's caller scope exactly as Publish now's
 * drain is, so the sweep is judged as a scheduled pass would be.
 */
const BOOTED_RUNNER: PluginSweepRunner = {
  run: (slug, maxDurationMs) => {
    if (!container.has("jobRegistry")) {
      throw NextlyError.internal({
        logContext: { reason: "job-registry-unregistered", slug },
      });
    }
    const adapter = container.get<JobsPassDatabase>("adapter");
    const registry = container.get<JobRegistry>("jobRegistry");
    return runDetachedFromRequest(() =>
      runSweepNow(adapter, registry, slug, { maxDurationMs })
    );
  },
};

/** The sweeps a plugin declares, by the slug the registry keys them under. */
function ownSweeps(plugin: PluginDefinition | undefined): ReadonlySet<string> {
  return new Set(
    (plugin?.contributes?.jobs ?? [])
      .filter(definition => definition.sweep === true)
      .map(definition => normalizeJobSlug(definition.slug))
  );
}

/** `ctx.services.jobs` for one plugin. */
export function pluginJobsNamespace(
  plugin: PluginDefinition | undefined,
  runner: PluginSweepRunner = BOOTED_RUNNER
): PluginJobsNamespace {
  // Read once: the definitions a plugin contributes are fixed when it is
  // registered, as the registry folded from them is.
  const sweeps = ownSweeps(plugin);
  return {
    ...createJobsNamespace(),
    async runSweepNow(slug, options) {
      const own = normalizeJobSlug(slug);
      // The precondition, before anything is queued or run.
      if (!sweeps.has(own)) {
        throw NextlyError.forbidden({
          logContext: {
            reason: "not-the-plugin's-own-sweep",
            plugin: plugin?.name,
            slug: own,
          },
        });
      }
      const budget = Math.min(
        options?.maxDurationMs ?? PLUGIN_SWEEP_NOW_MAX_MS,
        PLUGIN_SWEEP_NOW_MAX_MS
      );
      const result = await runner.run(own, budget);
      return { ran: result.claimed > 0 };
    },
  };
}
