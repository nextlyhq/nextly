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
 * dashboard). No specific permission is needed. The dashboard is the
 * landing page for all authenticated admin users.
 *
 * All three endpoints expose object-shaped reads with named fields, so they
 * use `respondData` (bare body, no envelope).
 *
 * @module api/dashboard
 * @since 1.0.0
 */

import type { AuthContext } from "../auth/middleware";
import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { getCachedNextly } from "../init";
import type { ActivityLogService } from "../services/dashboard/activity-log-service";
import type { DashboardService } from "../services/dashboard/dashboard-service";
import {
  allResources,
  someResources,
  type ReadableResources,
} from "../services/dashboard/readable-resources";
import {
  isSuperAdmin,
  listEffectivePermissions,
} from "../services/lib/permissions";

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

/** The `action-resource` prefix an API key's read grant is spelled with. */
const API_KEY_READ_PREFIX = "read-";

/**
 * Resolve what this caller may read.
 *
 * The AUTHENTICATION METHOD decides which grant is authoritative, so this takes
 * the whole auth context rather than a bare user id. For an API key
 * `auth.userId` is the key's OWNER, and a key exists precisely to carry less
 * reach than that owner: a super-admin who mints a role-based key bound to a
 * narrow role and hands it to an integration has deliberately narrowed it.
 * Authorizing by owner id resolves `isSuperAdmin` to true and returns `all`,
 * so the key reads every collection it holds no grant on. `collections-schema`
 * branches the same way, for the same reason.
 *
 * The two paths also speak different permission vocabularies, and neither
 * parser reads the other's spelling:
 *
 * - SESSION -- `listEffectivePermissions` builds `${resource}:${action}` from
 *   the `permissions` table's own columns, so a read grant is `posts:read`.
 * - API KEY -- `auth.permissions` carries the `permissions.slug` column, which
 *   is seeded as `${action}-${resource}`, so the same grant is `read-posts`.
 *
 * The api-key branch strips the prefix by LENGTH rather than splitting on `-`,
 * because a resource name may itself contain one: `read-site-settings` names
 * `site-settings`, and splitting yields `site`, which matches no collection.
 * That failure is silent -- it fails closed, so it reads as a working deny
 * rather than as a parser that cannot see the resource.
 *
 * Both branches preserve the EMPTY case rather than inverting it into "no
 * filter": `listEffectivePermissions` returns `[]` on any thrown error, and a
 * role-based key whose role was deleted resolves to `[]` too.
 */
async function resolveReadableResources(
  auth: AuthContext
): Promise<ReadableResources> {
  if (auth.authMethod === "api-key") {
    // The key's own resolved set is the whole bound -- no super-admin bypass,
    // because any super-admin reach the key was entitled to is already
    // reflected in the set `resolveApiKeyPermissions` stamped onto it.
    return someResources(
      auth.permissions
        .filter(slug => slug.startsWith(API_KEY_READ_PREFIX))
        .map(slug => slug.slice(API_KEY_READ_PREFIX.length))
    );
  }

  if (await isSuperAdmin(auth.userId)) return allResources();
  const permissionPairs = await listEffectivePermissions(auth.userId);
  return someResources(
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
  const scope = await resolveReadableResources(auth);
  const stats = await service.getStats({ scope });

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
    const scope = await resolveReadableResources(auth);
    // The caller WHOLE, not an id: `readCaller` resolves role IDs to the
    // SLUGS a role-based access rule matches, and carries an API key's own
    // stamped scope separately so it is judged on that rather than on
    // whoever minted it. See `getRecentFromCollection`'s use of it.
    const caller = await readCaller(auth);
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
 * `respondList`.
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
  const scope = await resolveReadableResources(auth);
  const result = await service.getRecentActivity({ limit, scope });

  // Cursor-shaped read: keep `hasMore` adjacent to `activities` and `total`.
  // Spread into a fresh literal so the response-shape generic accepts the
  // named `ActivityLogResult` interface (no implicit index signature).
  return respondData({ ...result }, { headers: PRIVATE_NO_STORE_HEADERS });
});
