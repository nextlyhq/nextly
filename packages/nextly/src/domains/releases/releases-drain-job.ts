/**
 * Materialising due releases as a job type.
 *
 * A release is a promise about a future instant, and nothing keeps a promise
 * unless something runs. This is that something: the runner's periodic sweep
 * reaches this job, the job asks which releases have come due, and performs
 * them through the ordinary content mutation as each member's own author.
 *
 * ## Why a factory rather than a bare definition
 *
 * Materialisation needs the raw adapter — the releases repository is built on
 * it — and a handler receives only its input and a context. The webhook drain
 * takes its dependencies the same way and for the same reason: widening
 * `JobContext` to carry the Nextly instance would point the jobs domain at the
 * instance that owns it.
 *
 * ## Why the pass reports rather than throws
 *
 * `applyDueReleases` records a per-member outcome and never lets one bad member
 * end the pass — an unresolvable author must not stop every other release on
 * the site. The handler therefore succeeds even when members failed, and their
 * releases stay `scheduled` so the next sweep retries them. Throwing here would
 * charge the whole sweep an attempt for one document's problem, and eventually
 * fail the sweep permanently over a single unrunnable member.
 *
 * @module domains/releases/releases-drain-job
 */

import type { RunAsDeps } from "../../shared/lib/resolve-run-as";
import type { JobContentSource } from "../jobs/job-content-api";
import { defineJob } from "../jobs/job-registry";
import type { JobDefinition } from "../jobs/job-registry";

import { applyDueReleases } from "./apply-due-releases";
import type { ApplyDueReleasesResult } from "./apply-due-releases";
import { createReleaseMutations } from "./release-mutations";
import { ReleasesRepository } from "./releases-repository";
import type { ReleasesDbApi } from "./releases-repository";

/** The registered slug. Stated once so the runner and the trigger agree. */
export const RELEASES_DRAIN_JOB = "releases:drain";

export function createReleasesDrainJob(deps: {
  db: ReleasesDbApi;
  /** The Direct API the member's bound client wraps. */
  contentApi: JobContentSource;
  /** The identity reads, so a member's author can be resolved. */
  runAs: RunAsDeps;
  /**
   * What to do with the outcome of each pass. REQUIRED.
   *
   * Not optional, because a pass can fail members while the job row completes
   * successfully: an author is deleted, a write is refused, a release is
   * cancelled mid-pass. Those releases stay `scheduled` and are retried
   * forever, and with an optional callback the only trace of why is a returned
   * object nobody read — no durable error, nothing for an administrator to
   * diagnose.
   *
   * The domain does not pick a logger: the wiring site knows where a report
   * belongs. Making it required is what forces that decision to be MADE rather
   * than defaulted to silence.
   */
  onOutcome: (result: ApplyDueReleasesResult) => void | Promise<void>;
  /**
   * How long one pass may spend STARTING content mutations.
   *
   * A drain runs behind a serverless cron tick as often as on a long-lived
   * process, and a platform kills a tick at a fixed limit. The runner cannot
   * bound this — `maxDurationMs` is checked before each CLAIM, so it bounds how
   * many JOBS a pass starts, not how long one handler takes — and `run-jobs`
   * names the handler being written to fit a tick as what bounds it instead.
   *
   * Taken here rather than read from `JobContext`, which carries `user`, `now`
   * and `content` but no deadline: a handler is asked to fit a tick and told
   * nothing about how long one is. Wiring a budget per job is the smaller
   * change; giving every handler its run's deadline is the better one, and it
   * belongs to the jobs domain rather than here.
   *
   * REQUIRED, for the same reason `onOutcome` is: optional, every existing
   * wiring site keeps the unbounded behaviour this exists to remove, and the
   * fix is opt-in for exactly the callers who do not know they need it. A
   * default would be a number invented here for a tick length only the wiring
   * site knows.
   */
  budgetMs: number;
}): JobDefinition {
  return defineJob({
    slug: RELEASES_DRAIN_JOB,
    // A sweep: a release comes due at an instant with no request attached, so
    // nothing is ever in a position to enqueue this. A trigger keeps one queued
    // instead. Without it the handler is registered and never runs, which looks
    // exactly like a site with no releases due.
    sweep: true,
    handler: async (_input, context) => {
      const startedAt = Date.now();
      const result = await applyDueReleases({
        // ONE clock for both halves. The deadline is derived from the runner's
        // `context.now`, so the comparison has to read the same source — left to
        // its default, `applyDueReleases` compares a virtual deadline against
        // real wall time, and a runner clock behind wall time stops after the
        // first release while one ahead never stops at all.
        //
        // `context.now` is the instant the runner is treating as now, so it does
        // not advance during the pass; elapsed time comes from the real clock
        // offset by the difference. That keeps a virtual clock authoritative for
        // WHEN the pass thinks it is, without making the budget unmeasurable.
        now: () => new Date(context.now.getTime() + (Date.now() - startedAt)),
        deadline: new Date(context.now.getTime() + deps.budgetMs),
        repository: new ReleasesRepository(deps.db),
        mutations: createReleaseMutations({ contentApi: deps.contentApi }),
        runAs: deps.runAs,
      });
      await deps.onOutcome(result);
    },
  });
}
