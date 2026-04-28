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
 * dashboard). No specific permission is needed — the dashboard is the
 * landing page for all authenticated admin users.
 *
 * Wire shape — Task 21 migration: all three handlers replace the legacy
 * nested envelope `{ data: { status, success, data: <result>, meta? } }`
 * with the canonical `{ data: <result> }` per spec §10.2. The error path
 * uses `application/problem+json` from `withErrorHandler`. Admin
 * consumers update in Task 10 (frontend simplification).
 *
 * @module api/dashboard
 * @since 1.0.0
 */

import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { getNextly } from "../init";
import type { ActivityLogService } from "../services/dashboard/activity-log-service";
import type { DashboardService } from "../services/dashboard/dashboard-service";
import {
  isSuperAdmin,
  listEffectivePermissions,
} from "../services/lib/permissions";

import { createSuccessResponse } from "./create-success-response";
import { withErrorHandler } from "./with-error-handler";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
} as const;

async function getDashboardService(): Promise<DashboardService> {
  await getNextly();
  return container.get<DashboardService>("dashboardService");
}

async function getActivityLogService(): Promise<ActivityLogService> {
  await getNextly();
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

  return createSuccessResponse(stats, { headers: PRIVATE_NO_STORE_HEADERS });
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

    return createSuccessResponse(entries, {
      headers: PRIVATE_NO_STORE_HEADERS,
    });
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
 * Body shape: `{ data: { activities, total, hasMore } }` — see the
 * file-level docstring for the migration note.
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

  return createSuccessResponse(result, { headers: PRIVATE_NO_STORE_HEADERS });
});
