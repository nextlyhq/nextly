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

import { container } from "../di";
import { jobDisplayStatus } from "../domains/jobs/job-display-status";
import type { JobsRepository } from "../domains/jobs/jobs-repository";
import { getCachedNextly } from "../init";

import { PRIVATE_NO_STORE_HEADERS } from "./authenticated-read";
import { respondList } from "./response-shapes";
import { requireRouteAnyPermission } from "./route-auth";
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
  /*
   * `requireRouteAnyPermission`, not `requireAnyPermission`. The latter RETURNS
   * an `ErrorResponse` rather than throwing, so awaiting it and discarding the
   * result authorizes nobody — an unauthorized caller walks straight past it to
   * the read. The throwing wrapper exists so a route cannot make that mistake,
   * and it is the one every other authenticated route here uses.
   */
  await requireRouteAnyPermission(request, [
    { action: "manage", resource: "background-jobs" },
  ]);

  await getCachedNextly();
  const repository = container.get<JobsRepository>("jobsRepository");
  const limit = readLimit(request);
  const rows = await repository.listRecent({ limit });
  const now = new Date();

  const items = rows.map(row => ({
    id: row.id,
    slug: row.slug,
    state: row.state,
    status: jobDisplayStatus(row, now),
    attemptCount: row.attemptCount,
    lastError: row.lastError,
    runAt: row.runAt,
    nextAttemptAt: row.nextAttemptAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));

  /*
   * The canonical list envelope, not a shape invented for this endpoint. A
   * generic consumer reads `items` and `meta` from every list in this API, and
   * a bespoke `{ jobs }` would be the one it cannot.
   *
   * `total` is the page's own length and the page count is 1, stated honestly
   * rather than fabricated: this endpoint answers "the most recent N", the seam
   * it reads through offers no count, and a second query for one would produce
   * a total that can disagree with the page beside it. A caller needing true
   * pagination should ask for it rather than infer it from a number that looks
   * like one.
   */
  return respondList(
    items,
    {
      total: items.length,
      page: 1,
      limit,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
    // Permission-scoped, and `lastError` is arbitrary internal text. Without
    // this a browser or shared cache can replay the body after logout, or to
    // another session, without authorization running again.
    { headers: PRIVATE_NO_STORE_HEADERS }
  );
});
