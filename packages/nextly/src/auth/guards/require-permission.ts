import type { AuthContext } from "../session/session-types.js";

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
 * Create a JSON Response from an ErrorResponse.
 */
export function createJsonErrorResponse(errResp: ErrorResponse): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(errResp.headers || {}),
  };

  return new Response(JSON.stringify(errResp), {
    status: errResp.statusCode,
    headers,
  });
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
  if (context.authMethod === "api-key") {
    // API keys have pre-resolved permissions
    const permSlug = `${action}-${resource}`;
    return context.permissions.get(permSlug) === true;
  }

  // Session auth -- use RBAC service
  if (deps.checkUserPermission) {
    return deps.checkUserPermission(context.userId, action, resource);
  }

  // Fallback: no RBAC service available (shouldn't happen in production)
  return false;
}
