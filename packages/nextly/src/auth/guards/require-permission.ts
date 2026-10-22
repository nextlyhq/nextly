import { permissionSlug } from "../../schemas/_zod/rbac";
import {
  INSTEAD_OF_AN_ACCESS_CHECK,
  warnDeprecatedExport,
} from "../deprecated-exports";
import { createJsonErrorResponse as answerRefusal } from "../middleware/error-response";
import type { AuthContext } from "../session/session-types";

export interface ErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  error: string;
  data: null;
  headers?: Record<string, string>;
}

/**
 * Create a JSON error response object.
 */
export function createErrorResponse(
  statusCode: number,
  message: string,
  error: string
): ErrorResponse {
  return { success: false, statusCode, message, error, data: null };
}

/**
 * Create a JSON Response from an ErrorResponse: the one error body every
 * refusal is answered with, as the auth middleware answers it.
 *
 * These guards put what a caller should read in `message` and the HTTP
 * reason in `error` (`"Missing API key"`, `"Unauthorized"`), the other way
 * round from the middleware, so `message` is the one answered.
 *
 * Pass the `request` to answer with its own request id (`x-request-id`, or a
 * proxy's); without it a new id is made.
 */
export function createJsonErrorResponse(
  errResp: ErrorResponse,
  request?: Request
): Response {
  return answerRefusal({ ...errResp, error: errResp.message }, request);
}

/**
 * Check if a value is an ErrorResponse.
 */
export function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    (value as ErrorResponse).success === false &&
    "statusCode" in value
  );
}

/**
 * Check a single permission against an AuthContext.
 * For session auth: delegates to RBAC service.
 * For API key auth: checks pre-resolved permissions map.
 *
 * @deprecated Use `nextly.access.check({ userId, resource, operation })`,
 * which asks the one access decision. Removed in the next release.
 */
export async function checkPermission(
  context: AuthContext,
  action: string,
  resource: string,
  deps: {
    checkUserPermission?: (
      userId: string,
      action: string,
      resource: string
    ) => Promise<boolean>;
  }
): Promise<boolean> {
  warnDeprecatedExport("checkPermission", INSTEAD_OF_AN_ACCESS_CHECK);
  return permissionHeld(context, action, resource, deps);
}

/**
 * The permission check itself, without the deprecation warning, for the
 * deprecated `checkCollectionAccess`, which warns under its own name.
 */
export async function permissionHeld(
  context: AuthContext,
  action: string,
  resource: string,
  deps: {
    checkUserPermission?: (
      userId: string,
      action: string,
      resource: string
    ) => Promise<boolean>;
  }
): Promise<boolean> {
  if (context.authMethod === "api-key") {
    // API keys have pre-resolved permissions
    const permSlug = permissionSlug(action, resource);
    return context.permissions.get(permSlug) === true;
  }

  // Session auth -- use RBAC service
  if (deps.checkUserPermission) {
    return deps.checkUserPermission(context.userId, action, resource);
  }

  // Fallback: no RBAC service available (shouldn't happen in production)
  return false;
}
