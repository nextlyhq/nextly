/**
 * Dashboard REST Handler Functions
 *
 * Three read-only endpoints for the admin dashboard:
 *
 *   GET /api/dashboard/stats          → aggregated content stats
 *   GET /api/dashboard/recent-entries → last edited entries across collections
 *   GET /api/dashboard/activity       → recent activity log entries
 *
 * All endpoints require authentication (any logged-in user can view the
 * dashboard). No specific permission is needed. The dashboard is the
 * landing page for all authenticated admin users.
 *
 * Wire shape: Phase 4 Task 11 migrates each handler off the legacy
 * `{ data: <result> }` envelope onto the canonical respondX helpers
 * (spec §5.1). All three endpoints expose object-shaped reads with
 * named fields, so they use `respondData` (bare body, no envelope).
 * Errors continue to flow through `withErrorHandler` and serialize as
 * `application/problem+json`.
 *
 * @module api/dashboard
 * @since 1.0.0
 */

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { getCachedNextly } from "../init";
import type { ActivityLogService } from "../services/dashboard/activity-log-service";
import type { DashboardService } from "../services/dashboard/dashboard-service";
import {
  isSuperAdmin,
  listEffectivePermissions,
} from "../services/lib/permissions";

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
 * Resolve the read-allowed resource set for a non-superadmin caller, or
 * `undefined` for a superadmin (which the dashboard service treats as
 * "no resource filter"). Centralized so each handler stays focused on its
 * own service call.
 */
async function resolveReadableResources(
  userId: string
): Promise<Set<string> | undefined> {
  if (await isSuperAdmin(userId)) return undefined;
  const permissionPairs = await listEffectivePermissions(userId);
  return new Set(
    permissionPairs
      .filter(pair => pair.endsWith(":read"))
      .map(pair => pair.split(":")[0])
  );
}

/**
 * GET /api/dashboard/stats
 *
 * Returns aggregated content statistics, draft/published breakdown,
 * per-collection entry counts, and admin metrics.
 *
 * Caching: `private, no-store` so the response never leaks across user
 * sessions in shared caches. `Vary: Cookie` reinforces this for any
 * cooperating intermediary.
 */
export const getDashboardStats = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const service = await getDashboardService();
  const readableResources = await resolveReadableResources(auth.userId);
  const stats = await service.getStats({ readableResources });

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
    const readableResources = await resolveReadableResources(auth.userId);
    const entries = await service.getRecentEntries(limit, readableResources);

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
 * GET /api/dashboard/activity?limit=5
 *
 * Returns recent activity log entries (create/update/delete actions).
 *
 * Query params:
 *   - limit: number (default: 5, max: 50)
 *
 * Body shape: `{ activities, total, hasMore }`. The activity feed is
 * cursor-style (`hasMore` flag, no page/limit/totalPages metadata
 * surfaced to clients), so this uses `respondData` rather than
 * `respondList`. See the file-level docstring for the migration note.
 */
export const getDashboardActivity = withErrorHandler(async (req: Request) => {
  const auth = await requireAuthentication(req);
  if (isErrorResponse(auth)) throw toNextlyAuthError(auth);

  const { searchParams } = new URL(req.url);
  const limitParam = searchParams.get("limit");
  const limit = limitParam
    ? Math.min(Math.max(Number(limitParam) || 5, 1), 50)
    : 5;

  const service = await getActivityLogService();
  const result = await service.getRecentActivity({ limit });

  // Cursor-shaped read: keep `hasMore` adjacent to `activities` and `total`.
  // Spread into a fresh literal so the response-shape generic accepts the
  // named `ActivityLogResult` interface (no implicit index signature).
  return respondData({ ...result }, { headers: PRIVATE_NO_STORE_HEADERS });
});
