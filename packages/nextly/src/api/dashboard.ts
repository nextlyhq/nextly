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

import { readableEntities } from "../auth/entity-read-access";
import { isErrorResponse, requireAuthentication } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { SETTINGS_ACTIVITY_NAMESPACES } from "../domains/audit/settings-activity-namespaces";
import { getCachedNextly } from "../init";
import type { ActivityLogService } from "../services/dashboard/activity-log-service";
import type { DashboardService } from "../services/dashboard/dashboard-service";
import {
  someResources,
  type ReadableResources,
  type ReadCaller,
} from "../services/dashboard/readable-resources";
import { registeredContentSlugs } from "../services/lib/registered-content-slugs";

import { readAccessCaller, readCaller } from "./authenticated-read";
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
 * Every name the dashboard can describe, offered for a read decision.
 *
 * Three sources, and the third is the one that is easy to miss.
 * {@link registeredContentSlugs} gives the collections and singles, so the set
 * being authorized is the set that would be counted -- it is shared with the
 * `system:versions` widget source, which bounds its cross-document read by the
 * same candidates. But the scope also bounds `/activity` and
 * `recentChanges24h`, which filter `activity_log.collection` -- and that column
 * is a FREE STRING whose namespace is deliberately wider than the registries.
 * `recordSettingsActivity` files settings mutations under names that are
 * neither a collection nor a single, so enumerating from the registries alone
 * removed every such row from the feed for every caller, super-admin included.
 * Rotating SMTP credentials is one of those rows. See
 * {@link SETTINGS_ACTIVITY_NAMESPACES}.
 *
 * Widening the CANDIDATES is not widening the answer: each name still goes to
 * `canReadEntity`, and each settings namespace has a real verdict there because
 * its `read-{name}` permission is seeded and already authorizes the
 * corresponding settings route.
 *
 * The per-collection COUNTS are unaffected by the third source.
 * `getRegisteredCollections` filters the registry list BY this scope, and
 * `filterByResource` can only ever narrow it -- a name that is not in the
 * registry cannot be added to it by appearing in the scope.
 */
async function registeredEntitySlugs(): Promise<string[]> {
  return [...SETTINGS_ACTIVITY_NAMESPACES, ...(await registeredContentSlugs())];
}

/**
 * Resolve what this caller may read, by ASKING the access layer.
 *
 * The decision is `canReadEntity`'s, taken once per registered entity, because
 * that is the only answer that agrees with what a row read will give. This used
 * to derive the set from permission SLUGS -- filtering `read-{slug}` for a key
 * and `{slug}:read` for a session -- and that is a second implementation of a
 * decision `checkAccess` already makes, which was more permissive than the
 * original in one direction and less in the other:
 *
 * - A collection whose `access.read` REFUSES the caller still has the
 *   `{slug}:read` row a slug filter admits it on, so `/stats` disclosed its
 *   count and `/activity` its entry titles, user names and emails, while
 *   `GET /api/collections/{slug}` correctly answered 403.
 * - A collection authorized ENTIRELY in code has no permission row to find, so
 *   a slug filter dropped a collection the caller can actually open.
 *
 * Asking removes both, and with them the two hand-rolled parsers and their
 * subtleties: there is no prefix to strip by length so that `read-site-settings`
 * keeps naming `site-settings`, because nothing is parsed. There is no
 * super-admin branch either -- `checkAccess` short-circuits on `isSuperAdmin`
 * before it reads any rule, so the bypass arrives through the same call as
 * everything else.
 *
 * One consequence is deliberate and worth naming: a super-admin's scope is now
 * the ENUMERATED set of registered entities rather than the unbounded `all`, so
 * an `activity_log` row naming a collection that is no longer registered is
 * filtered out. An unregistered slug has no rule and no registry entry to
 * decide against, and admitting what cannot be judged is the inversion this
 * whole endpoint was fixed to remove.
 */
async function resolveReadableResources(
  caller: ReadCaller
): Promise<ReadableResources> {
  const slugs = await registeredEntitySlugs();
  return someResources(await readableEntities(slugs, readAccessCaller(caller)));
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
  // The caller WHOLE, not an id. `readCaller` resolves session role IDs to the
  // SLUGS an access rule matches and carries an API key's own stamped scope,
  // and BOTH consumers read it: the scope resolution asks which entities are in
  // reach, and the per-collection counts are then read AS this caller so the
  // numbers describe rows it may actually see.
  const caller = await readCaller(auth);
  const scope = await resolveReadableResources(caller);
  const stats = await service.getStats({ scope, caller });

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
  // The caller WHOLE, and resolved ONCE. Both consumers read it: the scope
  // decides which collections are in reach, and the feed then authorizes each
  // row's DOCUMENT as this caller -- a stored owner-only or custom read rule
  // makes those two different sets, and a feed given only the scope reports one
  // author's entry titles to another.
  const caller = await readCaller(auth);
  const scope = await resolveReadableResources(caller);
  const result = await service.getRecentActivity({ limit, scope, caller });

  // Cursor-shaped read: `hasMore` sits beside `activities`, with no `total` --
  // see `ActivityLogResult` for why a count is not published here.
  // Spread into a fresh literal so the response-shape generic accepts the
  // named `ActivityLogResult` interface (no implicit index signature).
  return respondData({ ...result }, { headers: PRIVATE_NO_STORE_HEADERS });
});
