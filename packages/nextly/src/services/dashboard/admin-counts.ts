/**
 * Which of the dashboard summary's installation-wide counts a caller may be
 * given.
 *
 * How many users, roles, permissions, media items, field groups and active
 * API keys exist is not content: each describes a resource with its own list
 * endpoint and its own permission. A count is therefore given to exactly the
 * callers that endpoint admits, and LEFT OUT for anyone else -- a zero would
 * still be an answer, and one that changes when the rows behind it do.
 *
 * The decision is taken by the same middleware checks the endpoints use, for
 * a session and for an API key alike, so a key is judged on its own grant and
 * never on its owner's.
 *
 * @module services/dashboard/admin-counts
 */

import {
  authorizeCaller,
  authorizeCallerForAny,
  isErrorResponse,
  type AuthContext,
} from "../../auth/middleware";
import { apiKeyPermissionsFor } from "../../domains/auth/api-key-policy";
import { isSuperAdmin } from "../lib/permissions";

/** The counts, by the name the decision uses. */
export const ADMIN_COUNTS = [
  "apiKeys",
  "fieldGroups",
  "media",
  "permissions",
  "roles",
  "users",
] as const;

export type AdminCount = (typeof ADMIN_COUNTS)[number];

type Grant = { action: string; resource: string };

/**
 * What each count asks of a caller: any one of these, as its list endpoint
 * asks.
 *
 * - `permissions` asks `read-roles`, because that is what the permissions
 *   list admits (the role form's permission matrix reads it); `read-permissions`
 *   alone does not open the list, so it does not open the count.
 * - `fieldGroups` asks a settings grant, as every field-group read does.
 * - `apiKeys` takes the API-key read policy from where the API-key endpoints
 *   take it, so the two cannot disagree.
 */
const GRANTS: Readonly<Record<AdminCount, readonly Grant[]>> = {
  users: [{ action: "read", resource: "users" }],
  roles: [{ action: "read", resource: "roles" }],
  permissions: [{ action: "read", resource: "roles" }],
  media: [{ action: "read", resource: "media" }],
  fieldGroups: [
    { action: "read", resource: "settings" },
    { action: "manage", resource: "settings" },
  ],
  apiKeys: apiKeyPermissionsFor("read"),
};

/**
 * Whether `auth` holds any of `grants`.
 *
 * One grant goes through `authorizeCaller`, as `requirePermission` does, and
 * several through `authorizeCallerForAny`, as `requireAnyPermission` does: the
 * two differ for an API key (the single check also asks the entity's own
 * rule), and each count must be judged as its endpoint judges.
 */
async function holds(
  auth: AuthContext,
  grants: readonly Grant[]
): Promise<boolean> {
  const [only, ...rest] = grants;
  const result =
    only && rest.length === 0
      ? await authorizeCaller(auth, only.action, only.resource)
      : await authorizeCallerForAny(auth, [...grants]);
  return !isErrorResponse(result);
}

/**
 * Whose keys the API-key count covers for `auth`: every user's for a
 * super-admin, the caller's own for anyone else.
 *
 * The API-key list answers the same question the same way (`isSuperAdmin` on
 * the authenticated user), and the count must not describe keys the caller's
 * list would never show: holding `read-api-keys` opens one's own keys, not
 * everyone's.
 */
export async function apiKeyCountScope(
  auth: AuthContext
): Promise<ApiKeyCountScope> {
  return (await isSuperAdmin(auth.userId))
    ? { kind: "all" }
    : { kind: "owner", userId: auth.userId };
}

/**
 * Whose API keys a count covers. Tagged rather than a sentinel string, so no
 * user id can ever read as "everyone's".
 */
export type ApiKeyCountScope =
  | { readonly kind: "all" }
  | { readonly kind: "owner"; readonly userId: string };

/** The counts `auth` may be given. */
export async function readableAdminCounts(
  auth: AuthContext
): Promise<ReadonlySet<AdminCount>> {
  const verdicts = await Promise.all(
    ADMIN_COUNTS.map(
      async count => [count, await holds(auth, GRANTS[count])] as const
    )
  );
  return new Set(verdicts.filter(([, may]) => may).map(([count]) => count));
}
