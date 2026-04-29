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
 * Wire shape — Task 21 migration: handlers wrap `withErrorHandler` and return
 * the canonical `{ data: <result> }` envelope per spec §10.2. Errors flow
 * through the wrapper and serialize as `application/problem+json`. The
 * legacy non-paginated `{ data: [...], meta: { total } }` for `listApiKeys`
 * is replaced with the canonical `{ data: [...] }` (no synthetic pagination
 * meta — listing returns every key the caller is allowed to see). The
 * session-only 403 surface drops its policy-specific public message in
 * favor of the canonical "You don't have permission to perform this action."
 * (per §13.8); the legacy reason lives in `logContext`.
 *
 * @module api/api-keys
 * @since 1.0.0
 */

import { z } from "zod";

import { isErrorResponse, requireAnyPermission } from "../auth/middleware";
import { toNextlyAuthError } from "../auth/middleware/to-nextly-error";
import { container } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getNextly } from "../init";
import { CreateApiKeySchema, UpdateApiKeySchema } from "../schemas/api-keys";
import type { ApiKeyService } from "../services/auth/api-key-service";
import { isSuperAdmin } from "../services/lib/permissions";

import { createSuccessResponse } from "./create-success-response";
import { readJsonBody } from "./read-json-body";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

async function getApiKeyService(): Promise<ApiKeyService> {
  await getNextly();
  return container.get<ApiKeyService>("apiKeyService");
}

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
 * Throw the canonical FORBIDDEN error for session-only operations. The
 * legacy "API keys cannot be managed using an API key. Please sign in."
 * message is replaced with the §13.8-canonical sentence so every 403
 * across the API ships the same wording. The session-only reason and
 * the attempted action live in `logContext` for operator triage.
 */
function denySessionOnly(action: "create" | "update" | "delete"): never {
  throw NextlyError.forbidden({
    logContext: { reason: "session-only", action },
  });
}

/**
 * List API keys for the authenticated user.
 *
 * Super-admins see all keys across all users (`allUsers: true`).
 * Regular users see only their own keys.
 *
 * Auth: session or API key + `manage-api-keys` permission.
 *
 * Response: `{ "data": ApiKeyMeta[] }` — non-paginated list.
 */
export const listApiKeys = withErrorHandler(
  async (req: Request): Promise<Response> => {
    const authResult = await requireApiKeyPermission(req, "read");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    const service = await getApiKeyService();
    const allUsers = await isSuperAdmin(authResult.userId);
    const keys = await service.listApiKeys(authResult.userId, { allUsers });

    return createSuccessResponse(keys);
  }
);

/**
 * Fetch a single API key by ID.
 *
 * Non-super-admin callers can only fetch their own keys. The service returns
 * `null` for keys that don't exist or aren't owned by the caller, and this
 * handler returns 404 in both cases (no ownership leakage).
 *
 * Auth: session or API key + `manage-api-keys` permission.
 *
 * Response: `{ "data": ApiKeyMeta }`
 */
export function getApiKeyById(req: Request, id: string): Promise<Response> {
  return withErrorHandler(async (request: Request) => {
    const authResult = await requireApiKeyPermission(request, "read");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    const service = await getApiKeyService();
    const allUsers = await isSuperAdmin(authResult.userId);
    const key = await service.getApiKeyById(id, authResult.userId, {
      allUsers,
    });

    if (!key) {
      // Per §13.7 the public message stays "Not found." regardless of
      // whether the row was missing or merely owned by another user.
      throw NextlyError.notFound({
        logContext: { entity: "api-key", id, callerId: authResult.userId },
      });
    }

    return createSuccessResponse(key);
  })(req);
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
 * Response: `{ "data": { "doc": ApiKeyMeta, "key": string } }` — `key` is
 * the one-time raw secret. Status 201.
 */
export const createApiKey = withErrorHandler(
  async (req: Request): Promise<Response> => {
    const authResult = await requireApiKeyPermission(req, "create");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    if (authResult.authMethod !== "session") denySessionOnly("create");

    const body = await readJsonBody(req);

    let validated: z.infer<typeof CreateApiKeySchema>;
    try {
      validated = CreateApiKeySchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const service = await getApiKeyService();
    const { meta, key } = await service.createApiKey(
      authResult.userId,
      validated
    );

    return createSuccessResponse({ doc: meta, key }, { status: 201 });
  }
);

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
 * Response: `{ "data": ApiKeyMeta }`
 */
export function updateApiKey(req: Request, id: string): Promise<Response> {
  return withErrorHandler(async (request: Request) => {
    const authResult = await requireApiKeyPermission(request, "update");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    if (authResult.authMethod !== "session") denySessionOnly("update");

    const body = await readJsonBody(request);

    let validated: z.infer<typeof UpdateApiKeySchema>;
    try {
      validated = UpdateApiKeySchema.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) throw nextlyValidationFromZod(err);
      throw err;
    }

    const service = await getApiKeyService();
    const updated = await service.updateApiKey(
      id,
      authResult.userId,
      validated
    );

    return createSuccessResponse(updated);
  })(req);
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
 * Response: `{ "data": { "success": true } }`
 */
export function revokeApiKey(req: Request, id: string): Promise<Response> {
  return withErrorHandler(async (request: Request) => {
    const authResult = await requireApiKeyPermission(request, "delete");
    if (isErrorResponse(authResult)) throw toNextlyAuthError(authResult);

    if (authResult.authMethod !== "session") denySessionOnly("delete");

    const service = await getApiKeyService();
    await service.revokeApiKey(id, authResult.userId);

    return createSuccessResponse({ success: true });
  })(req);
}
