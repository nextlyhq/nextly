/**
 * The background job trigger.
 *
 * A queue only works if something drains it. This is that something's front
 * door: a scheduler calls it on an interval, and an operator can call it by
 * hand when they would rather not wait for the next tick.
 *
 * ## Why this adds no authorization of its own
 *
 * The webhook drain answered "who may pull a scheduler trigger" first, and its
 * answer — a shared secret compared constant-time, or an authenticated human
 * with a permission, with GET refused on the human path because a cross-site
 * navigation carries a `SameSite=Lax` cookie — is security reasoning that must
 * not exist twice. It lives in `api/trigger-auth.ts`; this route supplies the
 * one thing that genuinely differs between triggers, which is the permission a
 * human needs.
 *
 * ## What pulling this trigger does and does not confer
 *
 * It does not let the caller perform the queued work. Every job runs as the
 * identity it was queued with, reconstructed at execution and failing closed if
 * that identity no longer resolves. A holder of `manage-background-jobs` makes
 * already-queued, already-authorized work happen NOW; they do not acquire the
 * authority to do it themselves.
 *
 * @module api/jobs-run-route
 */

import { requireAnyPermission } from "../auth/middleware";
import { container } from "../di";
import type { JobRegistry } from "../domains/jobs/job-registry";
import {
  runJobsPass,
  type JobsPassDatabase,
} from "../domains/jobs/jobs-runner";
import { getCachedNextly } from "../init";

import { respondMutation } from "./response-shapes";
import { authorizeTrigger } from "./trigger-auth";
import { withErrorHandler } from "./with-error-handler";

/**
 * Bounds for one triggered pass.
 *
 * A trigger runs inside a request, and a serverless platform kills a request
 * that overruns its limit — mid-pass, with no chance to finalize. The queue is
 * durable, so a pass that stops early is not lost work: the next tick continues
 * from the same table. These numbers buy that safety, not throughput.
 */
const JOBS_RUN_BATCH_SIZE = 10;
/** Wall-clock budget for the pass, well inside a default serverless limit. */
const JOBS_RUN_MAX_DURATION_MS = 20_000;

/**
 * What a human needs to run the queue by hand.
 *
 * `manage-background-jobs` and nothing else: there is no `update` to widen from
 * the way `webhooks` has one, because running the queue is the only background
 * job surface that exists to authorize yet.
 */
function requireJobsRunPermission(
  request: Request
): ReturnType<typeof requireAnyPermission> {
  return requireAnyPermission(request, [
    { action: "manage", resource: "background-jobs" },
  ]);
}

/**
 * Run one background job pass: claim the jobs that are due and execute them.
 *
 * Idempotent and safe to call repeatedly — a scheduler (e.g. Vercel Cron, which
 * triggers with a GET) hits this on an interval, and a job's lease means two
 * overlapping passes cannot run the same job twice. Accepts GET or POST.
 *
 * Auth: a shared `NEXTLY_DRAIN_SECRET` or Vercel's `CRON_SECRET` (bearer,
 * constant-time) OR an authenticated caller with `manage-background-jobs`. Not
 * session-only: a scheduler has no session.
 *
 * Response: the canonical mutation envelope `{ message, item }`, where `item`
 * is the pass summary (claimed, succeeded, failed, retried).
 */
export const runJobsRoute = withErrorHandler(
  async (request: Request): Promise<Response> => {
    await authorizeTrigger(request, {
      requirePermission: requireJobsRunPermission,
      reason: "jobs-run",
    });

    await getCachedNextly();
    // The runtime adapter satisfies the jobs table surface AND the users read
    // the identity resolver needs; resolve it as exactly that from the
    // container. The registry is the shared singleton, so this pass can run
    // every job type the installation registered rather than whichever ones
    // this module happens to import.
    const adapter = container.get<JobsPassDatabase>("adapter");
    const registry = container.get<JobRegistry>("jobRegistry");

    const result = await runJobsPass(adapter, registry, {
      batchSize: JOBS_RUN_BATCH_SIZE,
      maxDurationMs: JOBS_RUN_MAX_DURATION_MS,
    });

    return respondMutation("Background job pass completed.", result);
  }
);
