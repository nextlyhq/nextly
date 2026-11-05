/**
 * Dashboard REST Handler Functions
 *
 * Three read-only endpoints for the admin dashboard:
 *
 *   GET /api/dashboard/stats          to aggregated content stats
 *   GET /api/dashboard/recent-entries to last edited entries across collections
 *   GET /api/dashboard/activity       to recent activity log entries
 *
 * All endpoints require authentication (any logged-in user can view the
 * dashboard). No specific permission is needed to call them, because the
 * dashboard is the landing page for all authenticated admin users; what each
 * one answers is scoped to what the caller may read.
 *
 * All three endpoints expose object-shaped reads with named fields, so they
 * use `respondData` (bare body, no envelope).
 *
 * @module api/dashboard
 * @since 1.0.0
 */

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { getCachedNextly } from "../init";
import type { ActivityLogService } from "../services/dashboard/activity-log-service";
import { readActivitySubjects } from "../services/dashboard/activity-subjects";
import {
  apiKeyCountScope,
  readableAdminCounts,
} from "../services/dashboard/admin-counts";
import type { DashboardService } from "../services/dashboard/dashboard-service";
import { resolveReadableResources } from "../services/dashboard/resolve-readable-resources";

import { readCaller } from "./authenticated-read";
import { respondData } from "./response-shapes";
import { withErrorHandler } from "./with-error-handler";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
} as const;

async function getDashboardService(): Promise<DashboardService> {
  await getCachedNextly();
  return container.get<DashboardService>("dashboardService");
}

async function getActivityLogService(): Promise<ActivityLogService> {
  await getCachedNextly();
  return container.get<ActivityLogService>("activityLogService");
}

/**
 * GET /api/dashboard/stats
 *
 * Returns aggregated content statistics, draft/published breakdown,
 * per-collection entry counts, and admin metrics. Each admin metric (users,
 * roles, permissions, media, field groups, active API keys) is present only
 * for a caller its own list endpoint admits, and absent otherwise.
 *
 * Caching: `private, no-store` so the response never leaks across user
 * sessions in shared caches. `Vary: Cookie` reinforces this for any
 * cooperating intermediary.
 */
export const getDashboardStats = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const service = await getDashboardService();
  // The caller WHOLE, not an id. `readCaller` resolves session role IDs to the
  // SLUGS an access rule matches and carries an API key's own stamped scope,
  // and BOTH consumers read it: the scope resolution asks which entities are in
  // reach, and the per-collection counts are then read AS this caller so the
  // numbers describe rows it may actually see.
  const caller = await readCaller(auth);
  const scope = await resolveReadableResources(caller);
  // Decided on the authenticated caller itself, so an API key is judged on
  // its own grant exactly as the users, roles, media and API-key endpoints
  // judge it.
  const counts = await readableAdminCounts(auth);
  // Whose keys the key count covers, as the API-key list decides it.
  const apiKeysOf = counts.has("apiKeys")
    ? await apiKeyCountScope(auth)
    : undefined;
  const stats = await service.getStats({ scope, caller, counts, apiKeysOf });

  // Bare-object read: stats is the dashboard summary itself; no envelope.
  // Spread into a fresh literal so respondData's `Record<string, unknown>`
  // bound is satisfied without leaning on a typecast (named interfaces lack
  // an implicit index signature).
  return respondData({ ...stats }, { headers: PRIVATE_NO_STORE_HEADERS });
});

/**
 * GET /api/dashboard/recent-entries?limit=5
 *
 * Returns the most recently modified entries across all collections.
 *
 * Query params:
 *   - limit: number (default: 5, max: 20)
 */
export const getDashboardRecentEntries = withErrorHandler(
  async (req: Request) => {
    const auth = await requireAuthentication(req);
    if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam
      ? Math.min(Math.max(Number(limitParam) || 5, 1), 20)
      : 5;

    const service = await getDashboardService();
    // The caller WHOLE, not an id: `readCaller` resolves role IDs to the
    // SLUGS a role-based access rule matches, and carries an API key's own
    // stamped scope separately so it is judged on that rather than on
    // whoever minted it. See `getRecentFromCollection`'s use of it.
    const caller = await readCaller(auth);
    const scope = await resolveReadableResources(caller);
    const entries = await service.getRecentEntries(limit, scope, caller);

    // Service returns `{ entries: [...] }` (a named-field object). This is a
    // capped non-paginated read (no total / page / limit semantics), so the
    // bare-object `respondData` shape applies rather than `respondList`.
    // Spread into a fresh literal so the response-shape generic accepts the
    // named `RecentEntriesResponse` interface (no implicit index signature).
    return respondData(
      { ...entries },
      {
        headers: PRIVATE_NO_STORE_HEADERS,
      }
    );
  }
);

/**
 * The row limit a request's `?limit` asked for, or none.
 *
 * Handed on as asked: the service clamps it, for this endpoint and for the
 * Recent activity card's widget source alike, so the two cannot disagree. Only
 * a number other than zero is a limit here: `?limit=0` and a value that is not
 * a number have always meant "the default", and still do.
 */
function askedLimit(req: Request): { limit?: number } {
  const asked = Number(new URL(req.url).searchParams.get("limit") ?? "");
  return asked ? { limit: asked } : {};
}

/**
 * GET /api/dashboard/activity?limit=5
 *
 * Returns recent activity log entries (create/update/delete actions).
 *
 * Query params:
 *   - limit: number (default: 5, max: 50)
 *
 * Body shape: `{ activities, hasMore }`. The activity feed is cursor-style
 * (`hasMore` flag, no page/limit/totalPages metadata surfaced to clients), so
 * this uses `respondData` rather than `respondList`.
 *
 * No `total`, deliberately: it counted the rows the collection scope admitted,
 * so it reported edits to documents the reader may not open, and narrowing it
 * would mean authorizing every matching row — unbounded over a table that only
 * grows. `ActivityLogResult` carries the same note beside the field's absence.
 */
export const getDashboardActivity = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const service = await getActivityLogService();
  // The caller WHOLE, and resolved ONCE. Both consumers read it: the scope
  // decides which collections are in reach, and the feed then authorizes each
  // row's DOCUMENT as this caller -- the read path's own filtering makes those
  // two different sets, and a feed given only the scope reports entry titles the
  // caller cannot open.
  const caller = await readCaller(auth);
  const scope = await resolveReadableResources(caller);
  // The Singles and the kept-off collections, read once and handed on whole, as the card's
  // source hands them: the two doors leave out the same rows.
  const result = await service.getRecentActivity({
    ...askedLimit(req),
    scope,
    caller,
    ...(await readActivitySubjects()),
  });

  // Cursor-shaped read: `hasMore` sits beside `activities`, with no `total` --
  // see `ActivityLogResult` for why a count is not published here. Named field
  // by field: the service's `next` position is for a caller that can pass it
  // back, and this endpoint takes no position to resume from.
  return respondData(
    { activities: result.activities, hasMore: result.hasMore },
    { headers: PRIVATE_NO_STORE_HEADERS }
  );
});
