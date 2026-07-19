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
  requireAnyPermission,
  requireAuthentication,
  requireCollectionAccess,
  requirePermission,
  type AuthContext,
  type ErrorResponse,
} from "../auth/middleware";
import { NextlyError } from "../errors/nextly-error";

/** Convert a middleware ErrorResponse into the equivalent thrown NextlyError. */
function throwAuthError(result: ErrorResponse): never {
  if (result.statusCode === 401) {
    // Preserve the middleware's TOKEN_EXPIRED code. The admin refresh
    // interceptor silently refreshes and retries only on TOKEN_EXPIRED;
    // AUTH_REQUIRED forces a logout. Collapsing every 401 to authRequired()
    // would turn a refreshable session into a hard logout on these routes.
    if (result.code === "TOKEN_EXPIRED") {
      throw NextlyError.tokenExpired({
        logContext: { middlewareCode: result.code },
      });
    }
    throw NextlyError.authRequired({
      logContext: { middlewareCode: result.code },
    });
  }
  if (result.statusCode === 429) {
    // Forward the backoff the middleware already computed: withErrorHandler
    // only emits the Retry-After response header when retryAfterSeconds is
    // present on the error, so a rate-limited client would otherwise lose it.
    const headerValue = result.headers?.["Retry-After"];
    const retryAfterSeconds = headerValue ? Number(headerValue) : undefined;
    throw NextlyError.rateLimited({
      retryAfterSeconds: Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds
        : undefined,
      logContext: { middlewareCode: result.code },
    });
  }
  throw NextlyError.forbidden({
    logContext: { middlewareCode: result.code, detail: result.error },
  });
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
 */
export async function requireRouteCollectionAccess(
  request: Request,
  action: string,
  collectionSlug: string
): Promise<AuthContext> {
  const result = await requireCollectionAccess(request, action, collectionSlug);
  if (isErrorResponse(result)) throwAuthError(result);
  return result;
}
