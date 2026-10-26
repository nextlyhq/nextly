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
 * So each gate is a value, and the value says HOW it is checked as well as
 * what it asks: `one` goes through the single-grant check, `any` through the
 * any-of check. The two differ for an API key (the single check also asks the
 * entity's own rule), so the route and the count must take the same path, not
 * merely ask the same grants. {@link requireListRead} reads a gate for a route
 * and {@link authorizeListRead} for a caller a gate has already authenticated;
 * both dispatch on `check` alike.
 *
 * @module auth/list-read-gates
 */

import { apiKeyPermissionsFor } from "../domains/auth/api-key-policy";

import {
  authorizeCaller,
  authorizeCallerForAny,
  isErrorResponse,
  requireAnyPermission,
  requirePermission,
  type AuthContext,
  type ErrorResponse,
  type RefusalTarget,
} from "./middleware";
import { toNextlyAuthError } from "./middleware/to-nextly-error";

/** A grant a list may ask for, as the route guards spell it. */
export interface ListGrant {
  readonly action: string;
  readonly resource: string;
}

/** What a list asks of a caller, and which check asks it. */
export type ListReadGate =
  | { readonly check: "one"; readonly grant: ListGrant }
  | {
      readonly check: "any";
      readonly grants: readonly ListGrant[];
      /** What a refusal names, where it is not what the grants are about. */
      readonly target?: RefusalTarget;
    };

/**
 * The gate of each list.
 *
 * - `permissions` admits `read-roles` (the role form's permission matrix reads
 *   it) and names the reading of permissions when it refuses; `read-permissions`
 *   alone does not open it.
 * - `fieldGroups` admits either settings grant, as every field-group read does.
 * - `apiKeys` takes the API-key read policy from where the key endpoints take it.
 */
export const LIST_READ_GATES = {
  users: { check: "one", grant: { action: "read", resource: "users" } },
  roles: { check: "one", grant: { action: "read", resource: "roles" } },
  permissions: {
    check: "any",
    grants: [{ action: "read", resource: "roles" }],
    target: { action: "read", resource: "permissions" },
  },
  media: { check: "one", grant: { action: "read", resource: "media" } },
  fieldGroups: {
    check: "any",
    grants: [
      { action: "read", resource: "settings" },
      { action: "manage", resource: "settings" },
    ],
  },
  apiKeys: { check: "any", grants: apiKeyPermissionsFor("read") },
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
  if (gate.check === "one") {
    return requirePermission(req, gate.grant.action, gate.grant.resource);
  }
  return requireAnyPermission(req, [...gate.grants], gate.target);
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
  if (gate.check === "one") {
    return authorizeCaller(auth, gate.grant.action, gate.grant.resource);
  }
  return authorizeCallerForAny(auth, [...gate.grants], gate.target);
}
