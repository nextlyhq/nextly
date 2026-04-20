import type { AuthContext } from "../session/session-types.js";

import {
  createErrorResponse,
  type ErrorResponse,
} from "./require-permission.js";

/**
 * Attempt API key authentication from the Authorization header.
 * Returns null if no Bearer token present (not an error -- caller should try session auth).
 * Returns ErrorResponse if token is present but invalid/expired/rate-limited.
 * Returns AuthContext on success.
 */
export async function authenticateApiKey(
  request: Request,
  deps: {
    validateApiKey: (rawKey: string) => Promise<{
      valid: boolean;
      userId?: string;
      permissions?: Map<string, boolean>;
      roles?: string[];
      error?: string;
      retryAfter?: number;
    }>;
  }
): Promise<AuthContext | ErrorResponse | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null; // No API key -- not an error
  }

  const rawKey = authHeader.slice(7); // Strip "Bearer " prefix
  if (!rawKey) {
    return createErrorResponse(401, "Missing API key", "Unauthorized");
  }

  const result = await deps.validateApiKey(rawKey);

  if (!result.valid) {
    if (result.retryAfter) {
      const resp = createErrorResponse(
        429,
        "Rate limit exceeded",
        "Too Many Requests"
      );
      resp.headers = { "Retry-After": String(result.retryAfter) };
      return resp;
    }
    return createErrorResponse(
      401,
      result.error || "Invalid API key",
      "Unauthorized"
    );
  }

  return {
    userId: result.userId!,
    userName: "",
    userEmail: "",
    permissions: result.permissions || new Map(),
    roles: result.roles || [],
    authMethod: "api-key",
  };
}
