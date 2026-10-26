/**
 * Who may read each system list, declared once.
 *
 * The users, roles, permissions, media, field-group and API-key lists each
 * gate on a grant, and the dashboard summary gives each list's
 * installation-wide count only to a caller that list admits. Two places need
 * the answer, and a copy in the second goes on admitting callers the first has
 * stopped admitting, which leaks how many rows sit behind a list the caller may
 * not open.
 *
 * So each gate is a value, a `RouteGrant`: one permission, checked through the
 * single-grant check, or `anyOf` several, checked through the any-of check and
 * naming `names` when it refuses. The two differ for an API key (the single
 * check also asks the entity's own rule), so the route and the count must take
 * the same path, not merely ask the same grants. {@link requireListRead} reads
 * a gate for a route and {@link authorizeListRead} for a caller a gate has
 * already authenticated; both dispatch on its shape as the Direct API's
 * `authorizeChecked` does.
 *
 * The users, roles, permissions and media gates ARE the system read policy's
 * (`SYSTEM_READ_POLICY`), the one the checked Direct API reads, so REST's
 * lists, the dashboard's counts and the Direct API cannot come to admit
 * different callers.
 *
 * @module auth/list-read-gates
 */

import { apiKeyPermissionsFor } from "../domains/auth/api-key-policy";
import {
  SYSTEM_READ_POLICY,
  type RouteGrant,
} from "../domains/auth/system-write-policy";

import {
  authorizeCaller,
  authorizeCallerForAny,
  isErrorResponse,
  requireAnyPermission,
  requirePermission,
  type AuthContext,
  type ErrorResponse,
} from "./middleware";
import { toNextlyAuthError } from "./middleware/to-nextly-error";

/** What a list asks of a caller, and which check asks it. */
export type ListReadGate = RouteGrant;

/**
 * The gate of each list.
 *
 * - `users`, `roles`, `permissions` and `media` are the system read policy's
 *   list reads: `permissions` admits `read-roles` (the role form's permission
 *   matrix reads it) and names the reading of permissions when it refuses.
 * - `fieldGroups` is the settings-gated field-group list's. The read policy
 *   has none to share: the Direct API reads field groups as the builder's
 *   palette does, open to any signed-in caller, and the dashboard counts them
 *   only for a caller the settings-gated list admits.
 * - `apiKeys` takes the API-key read policy from where the key endpoints take it.
 */
export const LIST_READ_GATES = {
  users: SYSTEM_READ_POLICY.users.read,
  roles: SYSTEM_READ_POLICY.roles.read,
  permissions: SYSTEM_READ_POLICY.permissions.list,
  media: SYSTEM_READ_POLICY.media.read,
  fieldGroups: {
    anyOf: [
      { action: "read", resource: "settings" },
      { action: "manage", resource: "settings" },
    ],
  },
  apiKeys: { anyOf: apiKeyPermissionsFor("read") },
} as const satisfies Record<string, ListReadGate>;

/** A list with a gate here. */
export type GatedList = keyof typeof LIST_READ_GATES;

/**
 * Whether the API-key list shows every user's keys, rather than the caller's
 * own: a caller the key gate admits sees them all. The list asks the key
 * service for them and the dashboard's key count covers them, both from here.
 */
export const API_KEY_LIST_COVERS_EVERY_USER: boolean = true;

/** `gate`, checked for a route's request. */
export function requireListRead(
  req: Request,
  gate: ListReadGate
): Promise<AuthContext | ErrorResponse> {
  if ("anyOf" in gate) {
    return requireAnyPermission(req, [...gate.anyOf], gate.names);
  }
  return requirePermission(req, gate.action, gate.resource);
}

/**
 * `gate`, checked for a standalone route's request, which throws its refusal
 * as the other `requireRoute*` gates do.
 */
export async function requireRouteListRead(
  req: Request,
  gate: ListReadGate
): Promise<AuthContext> {
  const result = await requireListRead(req, gate);
  if (isErrorResponse(result)) throw toNextlyAuthError(result);
  return result;
}

/** `gate`, checked for a caller a gate has already authenticated. */
export function authorizeListRead(
  auth: AuthContext,
  gate: ListReadGate
): Promise<AuthContext | ErrorResponse> {
  if ("anyOf" in gate) {
    return authorizeCallerForAny(auth, [...gate.anyOf], gate.names);
  }
  return authorizeCaller(auth, gate.action, gate.resource);
}
