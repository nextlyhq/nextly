/**
 * Reading the queue, as distinct from running it.
 *
 * A background job that fails is invisible: there is no request to inspect, no
 * status code, and no page that went blank. The outcome, the attempt count and
 * the error are all written to the row and, until this route existed, could
 * only be read with SQL. So a scheduled release that did not publish looked
 * exactly like one that was not due yet.
 *
 * ## Read-only, deliberately
 *
 * No retry, no cancel, no requeue. Those are writes on already-authorized work
 * and each needs its own decision about who may perform it; shipping them
 * beside a read would settle those questions by omission. What this closes is
 * the silent-failure gap, which is the part that costs somebody a morning.
 *
 * ## Why it takes the same permission as running the queue
 *
 * `lastError` carries whatever the handler threw — a database message, a remote
 * endpoint's response — which is internal detail rather than content. There is
 * no seeded `read-background-jobs`, and inventing one here would change what
 * preset roles grant as a side effect of adding a screen. Reusing
 * `manage-background-jobs` keeps that a separate, deliberate decision.
 *
 * @module api/jobs-list-route
 */

import { requireAnyPermission } from "../auth/middleware";
import { container } from "../di";
import { jobDisplayStatus } from "../domains/jobs/job-display-status";
import type { JobsRepository } from "../domains/jobs/jobs-repository";
import { getCachedNextly } from "../init";

import { respondData } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

/**
 * How many rows one read returns.
 *
 * A ceiling rather than a page size: this endpoint answers "what recently
 * happened", and a caller wanting more than this wants an archive, which the
 * seven-day prune means the table cannot supply anyway.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Clamped rather than refused: a caller asking for too much gets the ceiling. */
function readLimit(request: Request): number {
  const raw = new URL(request.url).searchParams.get("limit");
  if (raw === null) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * GET /api/jobs — the most recently touched jobs.
 *
 * Each row carries its DERIVED status beside the stored state, because the
 * stored one cannot distinguish a job that is retrying from one that has never
 * run — both are `pending` — and that is the distinction an operator needs
 * most. Deriving it here rather than in each client keeps one answer.
 *
 * The `input` column is deliberately NOT returned. It is arbitrary caller data
 * that may carry anything the enqueuing code put there, and a list view has no
 * use for it.
 */
export const listJobsRoute = withErrorHandler(async (request: Request) => {
  await requireAnyPermission(request, [
    { action: "manage", resource: "background-jobs" },
  ]);

  await getCachedNextly();
  const repository = container.get<JobsRepository>("jobsRepository");
  const rows = await repository.listRecent({ limit: readLimit(request) });

  return respondData({
    jobs: rows.map(row => ({
      id: row.id,
      slug: row.slug,
      state: row.state,
      status: jobDisplayStatus(row),
      attemptCount: row.attemptCount,
      lastError: row.lastError,
      runAt: row.runAt,
      nextAttemptAt: row.nextAttemptAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  });
});
