/**
 * API Key REST Handler Functions
 *
 * Named handler functions for the five API key endpoints. Each handler owns
 * its full auth + validation + service-call cycle:
 *
 *   requirePermission("update", "api-keys")  →  manage-api-keys system permission
 *   authMethod !== "session" guard           →  create / update / revoke are session-only
 *
 * These functions are called by the main route handler when it detects
 * `service === "apiKeys"` in the parsed route (wired in Subtask 3.2.1).
 *
 * @module api/api-keys
 * @since 1.0.0
 */

import { z } from "zod";

import {
  createJsonErrorResponse,
  isErrorResponse,
  requireAnyPermission,
} from "../auth/middleware";
import { container } from "../di";
import { isServiceError } from "../errors";
import { getNextly } from "../init";
import { CreateApiKeySchema, UpdateApiKeySchema } from "../schemas/api-keys";
import type { ApiKeyService } from "../services/auth/api-key-service";
import { isSuperAdmin } from "../services/lib/permissions";

async function getApiKeyService(): Promise<ApiKeyService> {
  await getNextly();
  return container.get<ApiKeyService>("apiKeyService");
}

function successResponse<T>(
  data: T,
  statusCode: number = 200,
  meta?: Record<string, unknown>
): Response {
  return Response.json({ data, ...(meta && { meta }) }, { status: statusCode });
}

function errorResponse(
  message: string,
  statusCode: number = 500,
  code?: string
): Response {
  return Response.json(
    { error: { message, ...(code && { code }) } },
    { status: statusCode }
  );
}

function handleError(error: unknown, operation: string): Response {
  console.error(`[API Keys] ${operation} error:`, error);

  if (isServiceError(error)) {
    return errorResponse(error.message, error.httpStatus, error.code);
  }

  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    return errorResponse(
      first?.message ?? "Validation error",
      400,
      "VALIDATION_ERROR"
    );
  }

  if (error instanceof Error) {
    return errorResponse(error.message, 500);
  }

  return errorResponse(`Failed to ${operation.toLowerCase()}`, 500);
}

const SESSION_ONLY_MESSAGE =
  "API keys cannot be managed using an API key. Please sign in.";

async function requireApiKeyPermission(
  req: Request,
  action: "create" | "read" | "update" | "delete"
) {
  return requireAnyPermission(req, [
    { action, resource: "api-keys" },
    { action: "update", resource: "api-keys" },
  ]);
}

/**
 * List API keys for the authenticated user.
 *
 * Super-admins see all keys across all users (`allUsers: true`).
 * Regular users see only their own keys.
 *
 * Auth: session or API key + `manage-api-keys` permission.
 *
 * Response: `{ data: ApiKeyMeta[], meta: { total: number } }`
 */
export async function listApiKeys(req: Request): Promise<Response> {
  try {
    const authResult = await requireApiKeyPermission(req, "read");
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const service = await getApiKeyService();
    const allUsers = await isSuperAdmin(authResult.userId);
    const keys = await service.listApiKeys(authResult.userId, { allUsers });

    return successResponse(keys, 200, { total: keys.length });
  } catch (error) {
    return handleError(error, "List API keys");
  }
}

/**
 * Fetch a single API key by ID.
 *
 * Non-super-admin callers can only fetch their own keys. The service returns
 * `null` for keys that don't exist or aren't owned by the caller, and this
 * handler returns 404 in both cases (no ownership leakage).
 *
 * Auth: session or API key + `manage-api-keys` permission.
 *
 * Response: `{ data: ApiKeyMeta }`
 */
export async function getApiKeyById(
  req: Request,
  id: string
): Promise<Response> {
  try {
    const authResult = await requireApiKeyPermission(req, "read");
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    const service = await getApiKeyService();
    const allUsers = await isSuperAdmin(authResult.userId);
    const key = await service.getApiKeyById(id, authResult.userId, {
      allUsers,
    });

    if (!key) {
      return errorResponse("API key not found", 404, "NOT_FOUND");
    }

    return successResponse(key);
  } catch (error) {
    return handleError(error, "Get API key");
  }
}

/**
 * Create a new API key for the authenticated session user.
 *
 * Session-only — cannot be called via an API key to prevent privilege
 * escalation. The raw key is returned exactly once in this response; it
 * is never stored and cannot be retrieved again.
 *
 * Auth: **session only** + `manage-api-keys` permission.
 *
 * Response: `{ doc: ApiKeyMeta, key: string }` — `key` is the one-time raw secret.
 */
export async function createApiKey(req: Request): Promise<Response> {
  try {
    const authResult = await requireApiKeyPermission(req, "create");
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    if (authResult.authMethod !== "session") {
      return errorResponse(SESSION_ONLY_MESSAGE, 403, "SESSION_REQUIRED");
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    const validated = CreateApiKeySchema.parse(body);
    const service = await getApiKeyService();
    const { meta, key } = await service.createApiKey(
      authResult.userId,
      validated
    );

    // 201 Created. `key` is the one-time raw secret — shown here only.
    return Response.json({ doc: meta, key }, { status: 201 });
  } catch (error) {
    return handleError(error, "Create API key");
  }
}

/**
 * Update an existing API key's name or description.
 *
 * Token type, role, and duration are immutable — revoke and recreate to
 * change them. Ownership is enforced at the service layer.
 *
 * Session-only — cannot be called via an API key.
 *
 * Auth: **session only** + `manage-api-keys` permission.
 *
 * Response: `{ data: ApiKeyMeta }`
 */
export async function updateApiKey(
  req: Request,
  id: string
): Promise<Response> {
  try {
    const authResult = await requireApiKeyPermission(req, "update");
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    if (authResult.authMethod !== "session") {
      return errorResponse(SESSION_ONLY_MESSAGE, 403, "SESSION_REQUIRED");
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "INVALID_JSON");
    }

    const validated = UpdateApiKeySchema.parse(body);
    const service = await getApiKeyService();
    const updated = await service.updateApiKey(
      id,
      authResult.userId,
      validated
    );

    return successResponse(updated);
  } catch (error) {
    return handleError(error, "Update API key");
  }
}

/**
 * Revoke (soft-delete) an API key.
 *
 * Sets `isActive = false` on the key. The row is preserved for audit trail
 * purposes. Ownership is enforced at the service layer.
 *
 * Session-only — cannot be called via an API key.
 *
 * Auth: **session only** + `manage-api-keys` permission.
 *
 * Response: `{ success: true }`
 */
export async function revokeApiKey(
  req: Request,
  id: string
): Promise<Response> {
  try {
    const authResult = await requireApiKeyPermission(req, "delete");
    if (isErrorResponse(authResult)) return createJsonErrorResponse(authResult);

    if (authResult.authMethod !== "session") {
      return errorResponse(SESSION_ONLY_MESSAGE, 403, "SESSION_REQUIRED");
    }

    const service = await getApiKeyService();
    await service.revokeApiKey(id, authResult.userId);

    return Response.json({ success: true }, { status: 200 });
  } catch (error) {
    return handleError(error, "Revoke API key");
  }
}
