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
 * Ownership is the registry's answer: it records the plugin that declared
 * each job as it registers it, from what `collectJobs` collected, and slugs
 * are unique across the app and every plugin, which `collectJobs` enforces at
 * boot. So what a plugin may run is what was actually registered as its own.
 *
 * ## Which installation
 *
 * The registry and the database come from the plugin context's own service
 * resolver, as its other services do, so a context left from an earlier
 * registration, or one of two instances in a process, runs the sweep on its
 * own installation, never on whichever the process container holds.
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
import {
  createJobsNamespace,
  type JobsNamespace,
} from "../../direct-api/namespaces/jobs";
import {
  normalizeJobSlug,
  type JobRegistry,
} from "../../domains/jobs/job-registry";
import type { JobsPassDatabase } from "../../domains/jobs/jobs-runner";
import type { RunJobsResult } from "../../domains/jobs/run-jobs";
import { NextlyError } from "../../errors/nextly-error";

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

/**
 * What running a sweep now needs from the installation: its job registry, to
 * say which sweeps a plugin declared, and the run itself. Injected so the
 * ownership rule is testable alone.
 */
export interface PluginSweepHost {
  registry(): Pick<JobRegistry, "get" | "pluginOf">;
  run(slug: string, maxDurationMs: number): Promise<RunJobsResult>;
}

/**
 * The host a plugin context offers: the registry and the database its own
 * service resolver answers, never the process container, so a sweep run now
 * runs on the instance that built the context, as every other context
 * service does. Run outside the request's caller scope exactly as Publish
 * now's drain is, so the sweep is judged as a scheduled pass would be.
 */
export function contextSweepHost(services: {
  registry: () => JobRegistry;
  database: () => JobsPassDatabase;
}): PluginSweepHost {
  return {
    registry: services.registry,
    run: async (slug, maxDurationMs) => {
      // Imported when a sweep runs, not with the context: the runner reaches
      // the Direct API, and every module that builds a plugin context would
      // otherwise load all of it to offer a method most never call.
      const { runSweepNow } = await import("../../domains/jobs/jobs-runner");
      const database = services.database();
      const registry = services.registry();
      return runDetachedFromRequest(() =>
        runSweepNow(database, registry, slug, { maxDurationMs })
      );
    },
  };
}

/**
 * How long a sweep run now may spend starting work: the one asked for, held
 * to {@link PLUGIN_SWEEP_NOW_MAX_MS}, or that when none is asked. A budget
 * that is not a number of milliseconds is refused rather than clamped: a NaN
 * passes through `Math.min`, and a runner told to stop at NaN never stops.
 */
function sweepBudget(asked: number | undefined): number {
  if (asked === undefined) return PLUGIN_SWEEP_NOW_MAX_MS;
  // `typeof` too: a JavaScript caller can hand anything to a public option.
  if (typeof asked !== "number" || Number.isNaN(asked) || asked < 0) {
    throw NextlyError.invalidInput({
      message:
        "runSweepNow's maxDurationMs must be a number of milliseconds, 0 or more.",
      logContext: { maxDurationMs: String(asked) },
    });
  }
  return Math.min(asked, PLUGIN_SWEEP_NOW_MAX_MS);
}

export function pluginJobsNamespace(
  pluginName: string | undefined,
  host: PluginSweepHost
): PluginJobsNamespace {
  return {
    ...createJobsNamespace(),
    async runSweepNow(slug, options) {
      const own = normalizeJobSlug(slug);
      // The precondition, before anything is queued or run: a sweep the
      // registry holds as this plugin's own declaration. Asked of the
      // registry, the one record of who declared what, rather than of the
      // plugin's manifest.
      const registry = host.registry();
      const declared =
        pluginName !== undefined &&
        registry.pluginOf(own) === pluginName &&
        registry.get(own)?.sweep === true;
      if (!declared) {
        throw NextlyError.forbidden({
          logContext: {
            reason: "not-the-plugin's-own-sweep",
            plugin: pluginName,
            slug: own,
          },
        });
      }
      const budget = sweepBudget(options?.maxDurationMs);
      const result = await host.run(own, budget);
      return { ran: result.claimed > 0 };
    },
  };
}
