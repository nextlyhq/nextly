import { container } from "@nextly/di/container";
import type { NextlyServiceConfig } from "@nextly/di/register";
import { env } from "@nextly/lib/env";
import type {
  AccessControlContext,
  CollectionAccessControl,
  SingleAccessControl,
} from "@nextly/services/auth/access-control-types";
import type { ApiKeyService } from "@nextly/services/auth/api-key-service";
import type { RBACAccessControlService } from "@nextly/services/auth/rbac-access-control-service";
import {
  hasPermission,
  hasAnyPermission,
} from "@nextly/services/lib/permissions";

// getSession from ../session is a backward-compat wrapper that delegates
// to the new jose-based session/get-session.ts module internally.
import { getSession } from "../session";

import { rateLimiter } from "./rate-limiter";

/** Fallback maximum requests per sliding window (1 000 req/hour). */
const DEFAULT_RATE_LIMIT = 1_000;
/** Fallback sliding window size in milliseconds (1 hour). */
const DEFAULT_RATE_WINDOW_MS = 3_600_000;

/**
 * Safely get the RBACAccessControlService from the DI container.
 *
 * Returns `undefined` if the container is not yet initialized or the
 * service is not registered (e.g., during early bootstrap before
 * `registerServices()` completes). Callers must fall back to direct
 * `hasPermission()` checks when `undefined` is returned.
 */
function getRBACService(): RBACAccessControlService | undefined {
  try {
    if (container.has("rbacAccessControlService")) {
      return container.get<RBACAccessControlService>(
        "rbacAccessControlService"
      );
    }
  } catch {
    // DI container not initialized yet — safe to ignore
  }
  return undefined;
}

/**
 * Safely get the ApiKeyService from the DI container.
 *
 * Returns `undefined` if the container is not yet initialized or the
 * service is not registered (e.g., during early bootstrap before
 * `registerServices()` completes).
 */
function getApiKeyService(): ApiKeyService | undefined {
  try {
    if (container.has("apiKeyService")) {
      return container.get<ApiKeyService>("apiKeyService");
    }
  } catch {
    // DI container not initialized yet — safe to ignore
  }
  return undefined;
}

/**
 * Safely get the registered Nextly config from the DI container.
 *
 * Returns `undefined` if the container is not yet initialized (e.g., during
 * early bootstrap). Callers fall back to module-level defaults when `undefined`
 * is returned.
 */
function getConfig(): NextlyServiceConfig | undefined {
  try {
    if (container.has("config")) {
      return container.get<NextlyServiceConfig>("config");
    }
  } catch {
    // DI container not initialized yet — safe to ignore
  }
  return undefined;
}

// PR 5 (unified-error-system): the AuthenticationError / AuthorizationError
// classes that used to live here have been deleted. They were dead code (no
// callers in this package) and their job is now performed by the canonical
// NextlyError factories: NextlyError.authRequired() and NextlyError.forbidden().
// Throw those at the call site; the route-handler boundary serialises them
// via toResponseJSON. The route-level ErrorResponse machinery below is kept
// for the duration of the migration — it is consumed by routeHandler.ts and
// many api/*.ts files that will be migrated in a later PR.

/**
 * Standardized error response structure.
 *
 * The optional `headers` field carries HTTP response headers that should be
 * forwarded to the client (e.g. rate-limit headers on 429 responses). It is
 * stripped from the JSON body by `createJsonErrorResponse()` — callers do not
 * need to handle it separately.
 */
export interface ErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  error: string;
  data: null;
  /**
   * Machine-readable error code (e.g. "TOKEN_EXPIRED", "AUTH_REQUIRED").
   * Included in the JSON body so clients can distinguish "needs refresh"
   * from "fully unauthenticated" without parsing the human-readable message.
   */
  code?: string;
  /** Optional HTTP response headers (e.g. Retry-After, X-RateLimit-*). Excluded from JSON body. */
  headers?: Record<string, string>;
}

/**
 * Create standardized error responses
 */
export function createErrorResponse(
  statusCode: number,
  message: string,
  error?: string,
  headers?: Record<string, string>,
  code?: string
): ErrorResponse {
  return {
    success: false,
    statusCode,
    message,
    error: error || message,
    data: null,
    ...(code && { code }),
    ...(headers && { headers }),
  };
}

/**
 * Unified authentication context.
 *
 * Returned by `requireAuthentication()` for both session-based and
 * API key-based requests. Downstream middleware and handlers receive
 * an identical shape regardless of auth method.
 *
 * - `authMethod: "session"` — authenticated via cookie/JWT session.
 *   `permissions` is `[]`; permission checks use the RBAC service with `userId`.
 *   `roles` is populated from the JWT.
 *
 * - `authMethod: "api-key"` — authenticated via `Authorization: Bearer` header.
 *   `permissions` is pre-resolved by `ApiKeyService.resolveApiKeyPermissions()`.
 *   `roles` is pre-resolved by `ApiKeyService.resolveApiKeyRoles()`.
 *
 * Handlers that are session-only (e.g. create/revoke API keys) should check:
 * ```typescript
 * if (ctx.authMethod !== "session") return 403;
 * ```
 */
export interface AuthContext {
  userId: string;
  userName?: string;
  userEmail?: string;
  permissions: string[];
  roles: string[];
  authMethod: "session" | "api-key";
}

/**
 * API key authentication middleware.
 *
 * Validates an `Authorization: Bearer sk_live_...` header and resolves the
 * effective permission set for the authenticated key. Returns a three-state result:
 *
 * - `null` — no `Authorization: Bearer` header present (or header is malformed).
 *   The caller should treat this as "API key not attempted" and fall through to
 *   other auth checks or return a generic 401.
 *
 * - `ErrorResponse { statusCode: 401 }` — a Bearer header was present but the key
 *   is invalid, expired, or revoked. The caller MUST propagate this response
 *   immediately — do NOT fall through silently.
 *
 * - `ErrorResponse { statusCode: 429 }` — the key is valid but the per-key rate limit
 *   has been exceeded. Includes `Retry-After` (seconds), `X-RateLimit-Limit`, and
 *   `X-RateLimit-Remaining` headers. Callers MUST propagate this via
 *   `createJsonErrorResponse()` so headers are forwarded to the client.
 *
 * - `{ userId, permissions, roles }` — the key is valid and within rate limit.
 *   `permissions` is the resolved array of permission slugs for this key's token type.
 *   `roles` is the resolved array of role slugs (single role for role-based keys;
 *   creator's roles otherwise).
 *
 * @example
 * ```typescript
 * const apiKeyResult = await requireApiKeyAuth(req);
 * if (apiKeyResult === null)          return // no key attempted
 * if (isErrorResponse(apiKeyResult))  return apiKeyResult; // invalid key — 401
 * // valid key — apiKeyResult.userId, apiKeyResult.permissions, and apiKeyResult.roles are populated
 * ```
 */
export async function requireApiKeyAuth(
  req: Request
): Promise<
  | { userId: string; permissions: string[]; roles: string[] }
  | ErrorResponse
  | null
> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null; // No API key attempted
  }

  const rawKey = authHeader.slice(7).trim(); // "Bearer ".length === 7
  if (!rawKey) {
    return null; // Malformed header — empty key after "Bearer "
  }

  const apiKeyService = getApiKeyService();
  if (!apiKeyService) {
    // Service unavailable during early bootstrap — key was attempted but cannot
    // be validated. Return 503 rather than null so the caller does not silently
    // treat a bearer token as "unauthenticated".
    return createErrorResponse(
      503,
      "Service Unavailable",
      "API key authentication service is not available"
    );
  }

  // 3. Hash and look up the key — returns null for not-found, revoked, or expired
  const keyAuth = await apiKeyService.authenticateApiKey(rawKey);
  if (!keyAuth) {
    // Key was present but invalid/expired/revoked — explicit 401, do NOT fall through
    return createErrorResponse(
      401,
      "Invalid API key",
      "The provided API key is invalid, expired, or revoked"
    );
  }

  // 4. Rate limit check — enforced after auth, before permission resolution.
  //    Limits come from defineConfig().apiKeys.rateLimit when available;
  //    module-level constants are the fallback for unconfigured deployments.
  const cfg = getConfig();
  const resolvedLimit =
    cfg?.apiKeys?.rateLimit.requestsPerHour ?? DEFAULT_RATE_LIMIT;
  const resolvedWindowMs =
    cfg?.apiKeys?.rateLimit.windowMs ?? DEFAULT_RATE_WINDOW_MS;

  const rl = rateLimiter.check(keyAuth.id, resolvedLimit, resolvedWindowMs);
  if (!rl.allowed) {
    const retryAfterSecs = Math.ceil(
      (rl.resetAt.getTime() - Date.now()) / 1000
    );
    return createErrorResponse(
      429,
      "Too Many Requests",
      "Rate limit exceeded for this API key",
      {
        "Retry-After": String(retryAfterSecs),
        "X-RateLimit-Limit": String(resolvedLimit),
        "X-RateLimit-Remaining": "0",
      }
    );
  }

  // 5. Resolve effective permissions and roles for this token type
  const [permissions, roles] = await Promise.all([
    apiKeyService.resolveApiKeyPermissions(
      keyAuth.tokenType,
      keyAuth.roleId,
      keyAuth.userId,
      keyAuth.id
    ),
    apiKeyService.resolveApiKeyRoles(
      keyAuth.tokenType,
      keyAuth.roleId,
      keyAuth.userId
    ),
  ]);

  return { userId: keyAuth.userId, permissions, roles };
}

/**
 * Authentication middleware — verifies the request is authenticated via
 * session or API key and returns a unified `AuthContext`.
 *
 * Flow:
 * 1. Check for a valid session (cookie/JWT). If found → `authMethod: "session"`.
 * 2. If no session, attempt API key auth via `Authorization: Bearer` header:
 *    - No header present → 401 (unauthenticated)
 *    - Header present but key is invalid/expired/revoked → propagate 401
 *    - Valid key → `authMethod: "api-key"` with pre-resolved `permissions`
 *
 * Session auth sets `permissions: []` (RBAC checks via `userId` on demand).
 * API key auth sets `permissions` to the pre-resolved set for the key's token type
 * and `roles` to the resolved role slugs for the key's token type.
 */
export async function requireAuthentication(
  req: Request
): Promise<AuthContext | ErrorResponse> {
  // getSession returns GetSessionResult; extract user or null for backward compat
  const sessionResult = await getSession(req, env.NEXTLY_SECRET || "");
  if (sessionResult.authenticated) {
    const { user } = sessionResult;
    return {
      userId: user.id,
      userName: user.name ?? undefined,
      userEmail: user.email ?? undefined,
      permissions: [],
      roles: user.roleIds,
      authMethod: "session",
    };
  }

  const apiKeyResult = await requireApiKeyAuth(req);

  // null → no Authorization header → truly unauthenticated.
  // If the session was expired, emit TOKEN_EXPIRED so the client can refresh
  // silently instead of bouncing the user to login.
  if (apiKeyResult === null) {
    if (sessionResult.reason === "expired") {
      return createErrorResponse(
        401,
        "Session expired",
        "Your session has expired, please refresh",
        undefined,
        "TOKEN_EXPIRED"
      );
    }
    return createErrorResponse(
      401,
      "Authentication required",
      "You must be logged in to access this resource",
      undefined,
      "AUTH_REQUIRED"
    );
  }

  // ErrorResponse → Bearer header was present but key is invalid — propagate
  if ("statusCode" in apiKeyResult) {
    return apiKeyResult;
  }

  return {
    userId: apiKeyResult.userId,
    permissions: apiKeyResult.permissions,
    roles: apiKeyResult.roles,
    authMethod: "api-key",
  };
}

/**
 * Permission-based authorization middleware.
 *
 * Delegates to `RBACAccessControlService.checkAccess()` when the DI
 * container is initialized, which evaluates:
 * 1. Super-admin bypass
 * 2. Code-defined access functions (from `defineCollection()` / `defineSingle()`)
 * 3. Database RBAC permission check
 *
 * Falls back to direct `hasPermission()` when the RBAC service is not
 * yet available (early bootstrap).
 */
export async function requirePermission(
  req: Request,
  action: string,
  resource: string
): Promise<AuthContext | ErrorResponse> {
  const authResult = await requireAuthentication(req);

  if ("statusCode" in authResult) {
    return authResult;
  }

  // API key auth: use pre-resolved permissions instead of DB lookup.
  // The permissions were already resolved by resolveApiKeyPermissions()
  // based on the key's token type (read-only → only read-* slugs, etc.).
  if (authResult.authMethod === "api-key") {
    const slug = `${action}-${resource}`;
    if (!authResult.permissions.includes(slug)) {
      return createErrorResponse(
        403,
        "Forbidden",
        `You do not have permission to ${action} ${resource}`
      );
    }
    return authResult;
  }

  // Session auth: existing RBAC flow (super-admin bypass → code access → DB check)
  const rbac = getRBACService();
  const hasAccess = rbac
    ? await rbac.checkAccess({
        userId: authResult.userId,
        operation: action as "create" | "read" | "update" | "delete",
        resource,
      })
    : await hasPermission(authResult.userId, action, resource);

  if (!hasAccess) {
    return createErrorResponse(
      403,
      "Forbidden",
      `You do not have permission to ${action} ${resource}`
    );
  }

  return authResult;
}

/**
 * Permission-based authorization middleware (any of multiple permissions)
 * Checks if authenticated user has at least one of the specified permissions
 */
export async function requireAnyPermission(
  req: Request,
  permissions: Array<{ action: string; resource: string }>
): Promise<AuthContext | ErrorResponse> {
  const authResult = await requireAuthentication(req);

  if ("statusCode" in authResult) {
    return authResult;
  }

  // API key auth: check against pre-resolved permissions
  if (authResult.authMethod === "api-key") {
    const hasAny = permissions.some(({ action, resource }) =>
      authResult.permissions.includes(`${action}-${resource}`)
    );
    if (!hasAny) {
      return createErrorResponse(
        403,
        "Forbidden",
        `You do not have the required permissions to access this resource`
      );
    }
    return authResult;
  }

  // Session auth: existing DB lookup
  const hasAccess = await hasAnyPermission(authResult.userId, permissions);

  if (!hasAccess) {
    return createErrorResponse(
      403,
      "Forbidden",
      `You do not have the required permissions to access this resource`
    );
  }

  return authResult;
}

/**
 * Collection-specific authorization middleware.
 *
 * Like `requirePermission()` but explicitly scoped to a collection slug.
 * Evaluates code-defined access from `defineCollection({ access })` via the
 * RBAC service, then falls back to database permission checks.
 *
 * Use this for dynamic collection entry routes where the collection slug
 * is extracted from the URL (e.g., `/api/collections/:slug/entries`).
 */
export async function requireCollectionAccess(
  req: Request,
  action: string,
  collectionSlug: string
): Promise<AuthContext | ErrorResponse> {
  const authResult = await requireAuthentication(req);

  if ("statusCode" in authResult) {
    return authResult;
  }

  // API key auth: use pre-resolved permissions, then evaluate code-defined access
  if (authResult.authMethod === "api-key") {
    const slug = `${action}-${collectionSlug}`;
    if (!authResult.permissions.includes(slug)) {
      return createErrorResponse(
        403,
        "Forbidden",
        `You do not have permission to ${action} ${collectionSlug}`
      );
    }

    // Permission slug matched — also check code-defined access functions
    // (e.g. defineCollection({ access: { create: ({ roles }) => ... } }))
    const rbac = getRBACService();
    if (rbac) {
      const codeAccess = rbac.getRegisteredAccess(collectionSlug);
      if (codeAccess) {
        const denied = await evaluateCodeAccess(
          codeAccess,
          action as "create" | "read" | "update" | "delete",
          collectionSlug,
          authResult
        );
        if (denied) return denied;
      }
    }

    return authResult;
  }

  // Session auth: existing RBAC flow (super-admin bypass → code access → DB check)
  const rbac = getRBACService();
  const hasAccess = rbac
    ? await rbac.checkAccess({
        userId: authResult.userId,
        operation: action as "create" | "read" | "update" | "delete",
        resource: collectionSlug,
      })
    : await hasPermission(authResult.userId, action, collectionSlug);

  if (!hasAccess) {
    return createErrorResponse(
      403,
      "Forbidden",
      `You do not have permission to ${action} ${collectionSlug}`
    );
  }

  return authResult;
}

/**
 * Evaluate a code-defined access function for an API key request.
 *
 * Builds an `AccessControlContext` using the API key's pre-resolved
 * permissions and roles (NOT the creator's full database permissions),
 * then evaluates the operation-specific access rule.
 *
 * Returns an `ErrorResponse` if access is denied, or `null` if allowed
 * (or if no rule is defined for the operation).
 */
async function evaluateCodeAccess(
  codeAccess: CollectionAccessControl | SingleAccessControl,
  operation: "create" | "read" | "update" | "delete",
  resource: string,
  authResult: AuthContext
): Promise<ErrorResponse | null> {
  const operationAccess =
    codeAccess[
      operation as keyof (CollectionAccessControl | SingleAccessControl)
    ];

  if (operationAccess === undefined) {
    return null; // No code-defined rule — permission slug check already passed
  }

  if (typeof operationAccess === "boolean") {
    return operationAccess
      ? null
      : createErrorResponse(
          403,
          "Forbidden",
          `You do not have permission to ${operation} ${resource}`
        );
  }

  // Function — build context with the API key's resolved roles/permissions
  const ctx: AccessControlContext = {
    user: { id: authResult.userId },
    roles: authResult.roles,
    permissions: authResult.permissions,
    operation,
    collection: resource,
  };

  try {
    const allowed = await operationAccess(ctx);
    return allowed
      ? null
      : createErrorResponse(
          403,
          "Forbidden",
          `You do not have permission to ${operation} ${resource}`
        );
  } catch (error) {
    console.error(
      `[auth] Code access function for ${operation}:${resource} threw:`,
      error
    );
    return createErrorResponse(
      403,
      "Forbidden",
      `You do not have permission to ${operation} ${resource}`
    );
  }
}

/**
 * Create JSON error response.
 *
 * Any `headers` on the `ErrorResponse` are forwarded as HTTP response headers
 * and excluded from the JSON body (so clients never see an unexpected
 * `headers` field in the payload).
 */
export function createJsonErrorResponse(error: ErrorResponse): Response {
  const { headers: extraHeaders, ...bodyPayload } = error;
  const responseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  return new Response(JSON.stringify({ data: bodyPayload }), {
    status: error.statusCode,
    headers: responseHeaders,
  });
}

/**
 * Helper to check if a result is an error response
 */
export function isErrorResponse(
  result: AuthContext | ErrorResponse
): result is ErrorResponse {
  return "statusCode" in result;
}
