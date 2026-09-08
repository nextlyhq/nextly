/**
 * Direct API `nextly.jobs.*` namespace — scheduling work for later.
 *
 * The queue side of the jobs domain, and only that. `defineJob` declares what a
 * job type DOES and the runner performs it; this is how anything asks for one to
 * happen — from a hook, a route, a plugin, or a script.
 *
 * Thin on purpose. `JobsRepository` already owns the insert, the dedupe
 * resolution and the portable length limits, and a facade that re-derived any of
 * that would be a second answer to a question the repository has already
 * answered. What this adds is reach: the repository is a class somebody must
 * construct with an adapter, and this is the one line a caller can write without
 * knowing that.
 *
 * @module direct-api/namespaces/jobs
 */

import { container } from "../../di/container";
import type { JobsRepository } from "../../domains/jobs/jobs-repository";
import { NextlyError } from "../../errors/nextly-error";
import type { JobSlug, QueueJobArgs, QueueJobResult } from "../types/jobs";

/**
 * `nextly.jobs.*` — schedule work to run later, as somebody, reliably.
 */
export interface JobsNamespace {
  /**
   * Queue a job.
   *
   * Returns once the row is committed, not once the work is done — that is the
   * whole point. The row survives a restart, so a queued job outlives the
   * request that queued it.
   *
   * Queueing does NOT run anything. A trigger drains the queue: the
   * `/api/jobs/run` route on a schedule, or a manual call. A job queued with
   * nothing draining stays queued.
   */
  queue<TTask extends JobSlug>(
    args: QueueJobArgs<TTask>
  ): Promise<QueueJobResult>;
}

/**
 * The repository, resolved from the container rather than constructed here.
 *
 * The registration owns a single instance; building a second one per call would
 * work — it is stateless over the adapter — but it would also be a second place
 * that decides what a repository is built from, and the first divergence would
 * be silent.
 */
function repository(): JobsRepository {
  if (!container.has("jobsRepository")) {
    // The public message stays the uniform internal-error sentence every other
    // 500 ships; the reason an operator needs goes to the log, which is where
    // this package puts diagnostics rather than in a body a client reads.
    throw NextlyError.internal({
      logContext: { reason: "jobs-repository-unregistered" },
    });
  }
  return container.get<JobsRepository>("jobsRepository");
}

export function createJobsNamespace(): JobsNamespace {
  return {
    async queue<TTask extends JobSlug>(
      args: QueueJobArgs<TTask>
    ): Promise<QueueJobResult> {
      const { id, deduped } = await repository().enqueue({
        slug: args.task,
        input: args.input ?? null,
        // `undefined` and `null` mean the same thing to a caller — "no delay" —
        // and the row stores one of them. Normalised here so the storage layer
        // is never asked to interpret an absent field.
        runAt: args.runAt ?? null,
        runAsUserId: args.runAs ?? null,
        dedupeKey: args.dedupeKey ?? null,
        now: new Date(),
      });
      return { id, deduped };
    },
  };
}
