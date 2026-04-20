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
 * @module api/dashboard
 * @since 1.0.0
 */

import {
  createJsonErrorResponse,
  isErrorResponse,
  requireAuthentication,
} from "../auth/middleware";
import { container } from "../di";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import type { ActivityLogService } from "../services/dashboard/activity-log-service";
import type { DashboardService } from "../services/dashboard/dashboard-service";
import {
  isSuperAdmin,
  listEffectivePermissions,
} from "../services/lib/permissions";

async function getDashboardService(): Promise<DashboardService> {
  await getNextly();
  return container.get<DashboardService>("dashboardService");
}

async function getActivityLogService(): Promise<ActivityLogService> {
  await getNextly();
  return container.get<ActivityLogService>("activityLogService");
}

function successResponse<T>(
  data: T,
  statusCode: number = 200,
  meta?: Record<string, unknown>,
  headers?: Record<string, string>
): Response {
  return Response.json(
    {
      data: { status: statusCode, success: true, data, ...(meta && { meta }) },
    },
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    }
  );
}

function errorResponse(
  message: string,
  statusCode: number = 500,
  code?: string
): Response {
  return Response.json(
    { error: { message, ...(code && { code }) } },
    { status: statusCode }
  );
}

function handleError(error: unknown, operation: string): Response {
  console.error(`[Dashboard API] ${operation} error:`, error);

  if (isServiceError(error)) {
    return errorResponse(error.message, error.httpStatus, error.code);
  }

  if (error instanceof Error) {
    return errorResponse(error.message, 500);
  }

  return errorResponse(`Failed to ${operation.toLowerCase()}`, 500);
}

/**
 * GET /api/dashboard/stats
 *
 * Returns aggregated content statistics, draft/published breakdown,
 * per-collection entry counts, and admin metrics.
 *
 * Cache-Control: private, max-age=60 — client-side caching for 1 minute.
 */
export async function getDashboardStats(req: Request): Promise<Response> {
  try {
    const authResult = await requireAuthentication(req);
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const service = await getDashboardService();
    let readableResources: Set<string> | undefined;
    const superAdmin = await isSuperAdmin(authResult.userId);
    if (!superAdmin) {
      const permissionPairs = await listEffectivePermissions(authResult.userId);
      readableResources = new Set(
        permissionPairs
          .filter(pair => pair.endsWith(":read"))
          .map(pair => pair.split(":")[0])
      );
    }

    const stats = await service.getStats({ readableResources });

    return successResponse(stats, 200, undefined, {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    });
  } catch (error) {
    return handleError(error, "Get dashboard stats");
  }
}

/**
 * GET /api/dashboard/recent-entries?limit=5
 *
 * Returns the most recently modified entries across all collections.
 *
 * Query params:
 *   - limit: number (default: 5, max: 20)
 */
export async function getDashboardRecentEntries(
  req: Request
): Promise<Response> {
  try {
    const authResult = await requireAuthentication(req);
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam
      ? Math.min(Math.max(Number(limitParam) || 5, 1), 20)
      : 5;

    const service = await getDashboardService();
    let readableResources: Set<string> | undefined;
    const superAdmin = await isSuperAdmin(authResult.userId);
    if (!superAdmin) {
      const permissionPairs = await listEffectivePermissions(authResult.userId);
      readableResources = new Set(
        permissionPairs
          .filter(pair => pair.endsWith(":read"))
          .map(pair => pair.split(":")[0])
      );
    }

    const entries = await service.getRecentEntries(limit, readableResources);

    return successResponse(entries, 200, undefined, {
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    });
  } catch (error) {
    return handleError(error, "Get recent entries");
  }
}

/**
 * GET /api/dashboard/activity?limit=5
 *
 * Returns recent activity log entries (create/update/delete actions).
 *
 * Query params:
 *   - limit: number (default: 5, max: 50)
 */
export async function getDashboardActivity(req: Request): Promise<Response> {
  try {
    const authResult = await requireAuthentication(req);
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam
      ? Math.min(Math.max(Number(limitParam) || 5, 1), 50)
      : 5;

    const service = await getActivityLogService();
    const result = await service.getRecentActivity({ limit });

    return successResponse(
      result,
      200,
      {
        total: result.total,
        hasMore: result.hasMore,
      },
      {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      }
    );
  } catch (error) {
    return handleError(error, "Get dashboard activity");
  }
}
