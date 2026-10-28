/**
 * Canonical authentication + authorization gate for the standalone
 * re-exportable route handlers in `nextly/api/*`.
 *
 * These handlers are wired by consumer apps on the public REST surface, so
 * they must enforce the exact same auth model as their dispatcher twins in
 * `resolveAuthorization()`: verified session cookie OR `Authorization:
 * Bearer nx_live_...` API key, then RBAC (super-admin bypass, code-defined
 * access rules, DB permission check, or the key's pre-resolved permission
 * set). A presence-only header check is not authentication.
 *
 * The middleware primitives return `AuthContext | ErrorResponse`; these
 * wrappers convert `ErrorResponse` into thrown `NextlyError`s so the
 * `withErrorHandler` boundary emits the canonical error envelope.
 */

import {
  isErrorResponse,
  requireAllPermissions,
  requireAnyPermission,
  requireAuthentication,
  requireCollectionAccess,
  requirePermission,
  type AuthContext,
  type ErrorResponse,
  type RouteOperation,
} from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";

/**
 * Throw a middleware ErrorResponse as the equivalent NextlyError, converted
 * as every other route converts one: the expired-session code, the refusal's
 * own words, a limit's retry hint and an unavailable service's status are
 * kept, and its reason goes to the log.
 */
function throwAuthError(result: ErrorResponse): never {
  throw toNextlyAuthError(result);
}

/**
 * Require a verified caller (session cookie or API key) without a specific
 * permission — for handlers that do their own per-resource filtering.
 * Mirrors the dispatcher's `requireAuthentication`.
 */
export async function requireRouteAuthentication(
  request: Request
): Promise<AuthContext> {
  const result = await requireAuthentication(request);
  if (isErrorResponse(result)) throwAuthError(result);
  return result;
}

/**
 * Require an authenticated caller holding `{action}-{resource}` (RBAC or
 * API-key permission set). Mirrors the dispatcher's `requirePermission`.
 */
export async function requireRoutePermission(
  request: Request,
  action: string,
  resource: string
): Promise<AuthContext> {
  const result = await requirePermission(request, action, resource);
  if (isErrorResponse(result)) throwAuthError(result);
  return result;
}

/**
 * Require an authenticated caller holding EVERY one of the given permissions.
 * Mirrors the dispatcher's `requireAllPermissions`.
 */
export async function requireRouteAllPermissions(
  request: Request,
  permissions: ReadonlyArray<{ action: string; resource: string }>
): Promise<AuthContext> {
  const result = await requireAllPermissions(request, permissions);
  if (isErrorResponse(result)) throwAuthError(result);
  return result;
}

/**
 * Require an authenticated caller holding ANY of the given permissions.
 * Mirrors the dispatcher's `requireAnyPermission`.
 */
export async function requireRouteAnyPermission(
  request: Request,
  permissions: Array<{ action: string; resource: string }>
): Promise<AuthContext> {
  const result = await requireAnyPermission(request, permissions);
  if (isErrorResponse(result)) throwAuthError(result);
  return result;
}

/**
 * Require an authenticated caller with collection-level access for the
 * given action + slug. Mirrors the dispatcher's `requireCollectionAccess`
 * (super-admin bypass, code-defined access rules, RBAC slug permissions).
 *
 * `operation` names the route's operation and parameters where they decide
 * the languages a rule is told; without it, the rule is told every language.
 */
export async function requireRouteCollectionAccess(
  request: Request,
  action: string,
  collectionSlug: string,
  operation?: RouteOperation
): Promise<AuthContext> {
  const result = await requireCollectionAccess(
    request,
    action,
    collectionSlug,
    // This route requires a caller, so it never admits a visitor.
    operation && { ...operation, admitsVisitor: false }
  );
  if (isErrorResponse(result)) throwAuthError(result);
  return result;
}
