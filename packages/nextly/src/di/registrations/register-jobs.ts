/**
 * Background job DI registrations.
 *
 * Two singletons, and the reason there are two is the whole shape of the
 * domain: `jobsRepository` is where jobs are WRITTEN — anything that wants work
 * done later enqueues through it — and `jobRegistry` is where the code that
 * performs them is looked up. A trigger needs both, and it must find the same
 * two every pass: a registry built per request would answer for whatever job
 * types that request happened to import, so a job queued by one route could be
 * unrunnable from another.
 *
 * This is also the site that turns a job DEFINITION into a registered one.
 * `defineJob` produces a value; until something puts it in a registry the
 * runner cannot see it, and a queued row for its slug is deferred forever while
 * looking exactly like an empty queue. Every built-in job type is registered
 * here, so "which jobs can this installation run" has one answer that a reader
 * can check.
 *
 * @module di/registrations/register-jobs
 */

import { nextly } from "../../direct-api/nextly";
import { JobRegistry } from "../../domains/jobs/job-registry";
import { JobsRepository } from "../../domains/jobs/jobs-repository";
import { databaseRunAs } from "../../domains/jobs/jobs-runner";
import type { ApplyDueReleasesResult } from "../../domains/releases/apply-due-releases";
import { createReleasesDrainJob } from "../../domains/releases/releases-drain-job";
import {
  IN_PASS_DRAIN_BOUNDS,
  type RunWebhookDrainOptions,
  type WebhookDrainDatabase,
} from "../../domains/webhooks/drain-runner";
import type { WebhookEndpointRegistry } from "../../domains/webhooks/endpoint-registry";
import type { RunDrainResult } from "../../domains/webhooks/run-drain";
import { createWebhookDrainJob } from "../../domains/webhooks/webhook-drain-job";
import { collectJobs } from "../../plugins/jobs/collect-jobs";
import type { Logger } from "../../services/shared";
import { container } from "../container";

import type { RegistrationContext } from "./types";

/**
 * Report what a releases pass did, and say so loudly when a member failed.
 *
 * `createReleasesDrainJob` requires this rather than defaulting it, and the
 * requirement is the point: a pass can fail individual members while the job
 * row completes successfully — a deleted author, a refused write, a release
 * cancelled mid-pass. Those releases stay `scheduled` and are retried on every
 * later sweep, so without a report the only trace of a release that will never
 * publish is a returned object nobody read.
 *
 * Failures are logged per member, not as a count. "3 failed" tells an operator
 * that something is wrong; the document and the reason are what let them fix
 * it, and a release stuck on one deactivated author is indistinguishable from
 * three unrelated problems until you can see which is which.
 *
 * Exported so that contract is testable. It is the reason `onOutcome` is a
 * required parameter rather than an optional one, and a reporter whose only
 * guard is a comment is a guarantee nobody can prove still holds.
 */
/**
 * How long a `releases:drain` pass may spend starting releases.
 *
 * Under the shortest serverless limit this trigger runs behind, with room left
 * for the pass to discharge the releases it did finish. A pass that runs out
 * defers the rest to the next tick rather than being killed part-way.
 */
const RELEASES_DRAIN_BUDGET_MS = 10_000;

export function reportReleasesOutcome(
  logger: Logger,
  result: ApplyDueReleasesResult
): void {
  if (result.due === 0) return;

  logger.info("Content releases pass completed", {
    due: result.due,
    published: result.published,
    applied: result.applied,
    failed: result.failed,
    // Without this a bounded pass logs EXACTLY like an ordinary one: same
    // counts, no sign that scheduled work was left behind. Reporting the field
    // from `applyDueReleases` and then dropping it here would defeat the whole
    // reason it exists — an operator watching a backlog stall would see a run
    // of clean completions.
    deferred: result.deferred,
    // Distinct from `deferred`: a truncated pass over empty releases omits no
    // ACTION, so `deferred` is zero while releases stay scheduled. Without this
    // the one case the finalization bound handles is the one it cannot report.
    undischarged: result.undischarged,
  });

  for (const outcome of result.outcomes) {
    if (outcome.failure === null) continue;
    logger.error("A release member could not be materialised", {
      releaseId: outcome.releaseId,
      memberId: outcome.memberId,
      scopeKind: outcome.ref.scopeKind,
      scopeSlug: outcome.ref.scopeSlug,
      entryId: outcome.ref.entryId,
      locale: outcome.ref.locale,
      effect: outcome.effect,
      failure: outcome.failure,
      detail: outcome.detail,
    });
  }
}

/**
 * Report what a webhook drain pass did, and say so when deliveries failed.
 *
 * Same requirement, same reason as the releases reporter: the job row completes
 * while individual deliveries fail, so without this the only trace of an
 * endpoint that has stopped receiving anything is a returned object nobody read.
 *
 * Reported per pass rather than per delivery, unlike releases. A delivery
 * already has its own durable row in the delivery log with its own error, so a
 * line per failure would duplicate what an operator can already page through;
 * what the log cannot show is that a whole pass finished with failures in it.
 */
export function reportWebhookDrainOutcome(
  logger: Logger,
  result: RunDrainResult
): void {
  if (result.eventsProcessed === 0 && result.attempted === 0) return;

  logger.info("Webhook drain pass completed", {
    rounds: result.rounds,
    eventsProcessed: result.eventsProcessed,
    deliveriesCreated: result.deliveriesCreated,
    attempted: result.attempted,
    delivered: result.delivered,
    retried: result.retried,
    failed: result.failed,
    abandoned: result.abandoned,
  });

  if (result.failed > 0) {
    logger.error("A webhook drain pass ended with failed deliveries", {
      failed: result.failed,
      retried: result.retried,
      attempted: result.attempted,
    });
  }
}

export function registerJobServices(ctx: RegistrationContext): void {
  const { adapter, logger } = ctx;

  // Collected EAGERLY, here, rather than inside the registry factory below.
  // `registerSingleton` stores a factory and runs it on first `get`, and the
  // only production caller of `get("jobRegistry")` is a drain — so a duplicate
  // slug or a reserved namespace would let boot and every enqueue succeed, and
  // then fail every drain, instead of refusing to start. A collision is a
  // configuration error, and a configuration error should stop the boot that
  // introduced it.
  const declaredJobs = collectJobs(ctx.config, ctx.config.plugins ?? []);

  container.registerSingleton<JobsRepository>(
    "jobsRepository",
    () => new JobsRepository(adapter)
  );

  container.registerSingleton<JobRegistry>("jobRegistry", () => {
    const registry = new JobRegistry();

    // Content releases, consumer #1 of the runner. Constructed here rather than
    // in the releases domain because a job type is only real once something
    // registers it, and the registry is the thing that decides which jobs an
    // installation can run.
    //
    // `runAs` is the means to RESOLVE an identity, never a principal: the pass
    // resolves each member's own author, so one release carrying members by
    // different people fails only the member whose author is gone. Passing a
    // principal here instead would turn "schedule this" into a privilege
    // escalation with a delay on it.
    registry.register(
      createReleasesDrainJob({
        db: adapter,
        // The Direct API facade, whose operations survive extraction; the
        // handler binds each call to the member's own resolved identity.
        contentApi: nextly,
        runAs: databaseRunAs(adapter),
        // How long one pass may spend starting releases. Chosen here because
        // this is the only place that knows what runs the tick: the domain
        // cannot invent a tick length, and leaving it optional would have kept
        // the unbounded behaviour for exactly the callers who do not know they
        // need it. Ten seconds sits under the shortest serverless limit this
        // runs behind while leaving room for the pass to discharge what it did.
        budgetMs: RELEASES_DRAIN_BUDGET_MS,
        onOutcome: result => reportReleasesOutcome(logger, result),
      })
    );

    // Webhook delivery, consumer #1 of the runner and the workload the jobs
    // domain was extracted FROM. `/api/webhooks/drain` still exists and still
    // works; this means an installation scheduling `/api/jobs/run` gets its
    // webhooks drained too, so a new deployment needs one cron entry rather than
    // one per subsystem.
    //
    // Resolved lazily inside the factory: the webhook registrations run before
    // this one, but resolving at registry-construction time rather than at
    // module load keeps the order a fact about the container rather than about
    // import graphs.
    registry.register(
      createWebhookDrainJob(
        container.get<WebhookDrainDatabase>("adapter"),
        container.get<WebhookEndpointRegistry>("webhookEndpointRegistry"),
        {
          // Sized to fit INSIDE the jobs pass that runs it, not the webhook
          // route's own tick. `runJobs` checks its budget before starting a
          // handler and cannot interrupt one, so a handler that begins with a
          // wider budget than the pass can outlive the invocation and be killed
          // before it finalizes. Derived from the pass budget rather than
          // restated, so raising one raises the other.
          ...IN_PASS_DRAIN_BOUNDS,
          retention: container.get<RunWebhookDrainOptions["retention"]>(
            "webhookRetentionDeps"
          ),
        },
        result => reportWebhookDrainOutcome(logger, result)
      )
    );
    // Job types the application and its plugins declared. Registered AFTER the
    // built-ins so a plugin cannot shadow one: `collectJobs` already refuses a
    // reserved namespace, and `JobRegistry.register` refuses a duplicate slug
    // outright rather than replacing the incumbent — which would make the
    // winner depend on load order and leave the loser silently unrun.
    for (const { definition } of declaredJobs) {
      registry.register(definition);
    }

    return registry;
  });
}
