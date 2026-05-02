/**
 * API Key API Service
 *
 * API client for managing API keys. Supports listing, creating, updating,
 * and revoking keys.
 *
 * Phase 4 (Task 19, plan T4.15): the bespoke `apiKeyFetch` helper is gone.
 * Every endpoint now uses the shared `fetcher` typed against the canonical
 * envelope helpers (`ListResponse`, `MutationResponse`, `ActionResponse`)
 * from `lib/api/response-types.ts`. This brings api-keys onto the same
 * wire contract as the rest of the admin services.
 *
 * @example
 * ```ts
 * import { apiKeyApi } from '@admin/services/apiKeyApi';
 *
 * const { data, meta } = await apiKeyApi.fetchApiKeys();
 * const { doc, key } = await apiKeyApi.createApiKey({ name: 'CI Key', tokenType: 'read-only', expiresIn: '30d' });
 * ```
 */

import { fetcher } from "../lib/api/fetcher";
import type {
  ActionResponse,
  ListResponse,
  MutationResponse,
} from "../lib/api/response-types";

// ============================================================
// Types
// ============================================================

export type ApiKeyTokenType = "read-only" | "full-access" | "role-based";
export type ApiKeyExpiresIn = "7d" | "30d" | "90d" | "unlimited";

/** Metadata shape returned by the backend for every key. The raw secret is never included. */
export interface ApiKeyMeta {
  id: string;
  name: string;
  description: string | null;
  /** First 16 characters of the key — e.g. "sk_live_abcdefgh". Used for masked display only. */
  keyPrefix: string;
  tokenType: ApiKeyTokenType;
  /** Populated only when tokenType is "role-based". */
  role: { id: string; name: string; slug: string } | null;
  /** ISO 8601 timestamp, or null when the key never expires. */
  expiresAt: string | null;
  /** ISO 8601 timestamp, or null when the key has never been used. */
  lastUsedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApiKeyPayload {
  name: string;
  description?: string;
  tokenType: ApiKeyTokenType;
  /** Required when tokenType is "role-based"; must be absent otherwise. */
  roleId?: string;
  expiresIn: ApiKeyExpiresIn;
}

export interface UpdateApiKeyPayload {
  /** Omit to leave unchanged. */
  name?: string;
  /** Omit to leave unchanged. Pass null to explicitly clear. */
  description?: string | null;
}

export interface ApiKeyListMeta {
  total: number;
}

export interface ApiKeyListResponse {
  data: ApiKeyMeta[];
  meta: ApiKeyListMeta;
}

/** Returned by createApiKey. `key` is the one-time raw secret — shown once, never retrievable again. */
export interface CreateApiKeyResult {
  doc: ApiKeyMeta;
  key: string;
}

// ============================================================
// API Functions
// ============================================================

/**
 * List all API keys visible to the authenticated user.
 *
 * Super-admins see keys across all users. Regular users see only their own.
 *
 * Phase 4 (Task 19): server returns canonical `ListResponse<ApiKeyMeta>`
 * (`{ items, meta }`). We project to the legacy `{ data, meta: { total } }`
 * shape callers expect.
 */
export async function fetchApiKeys(): Promise<ApiKeyListResponse> {
  const result = await fetcher<ListResponse<ApiKeyMeta>>("/api-keys", {}, true);
  return {
    data: result.items,
    meta: { total: result.meta.total },
  };
}

/**
 * Create a new API key.
 *
 * Session-only — cannot be called via an existing API key.
 * The raw `key` in the result is shown exactly once; it is never stored
 * and cannot be retrieved again.
 *
 * Phase 4 (Task 19): server returns
 * `MutationResponse<{ doc, key }>` (`{ message, item: { doc, key } }`); we
 * project `item` to keep the legacy `{ doc, key }` callers expect.
 */
export async function createApiKey(
  input: CreateApiKeyPayload
): Promise<CreateApiKeyResult> {
  const result = await fetcher<MutationResponse<CreateApiKeyResult>>(
    "/api-keys",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
    true
  );
  return { doc: result.item.doc, key: result.item.key };
}

/**
 * Update the name or description of an existing API key.
 *
 * Token type, role, and duration are immutable — revoke and recreate to
 * change them. Session-only.
 *
 * Phase 4 (Task 19): server returns `MutationResponse<ApiKeyMeta>`;
 * project `item` for the bare-record public signature.
 */
export async function updateApiKey(
  id: string,
  input: UpdateApiKeyPayload
): Promise<ApiKeyMeta> {
  const result = await fetcher<MutationResponse<ApiKeyMeta>>(
    `/api-keys/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
    true
  );
  return result.item;
}

/**
 * Revoke (soft-delete) an API key.
 *
 * Sets `isActive = false`. The row is preserved for audit purposes.
 * Session-only.
 *
 * Phase 4 (Task 19): server returns `respondAction("API key revoked.", { id })`;
 * we discard the body since the caller expects void.
 */
export async function revokeApiKey(id: string): Promise<void> {
  await fetcher<ActionResponse<{ id: string }>>(
    `/api-keys/${id}`,
    {
      method: "DELETE",
    },
    true
  );
}

export const apiKeyApi = {
  fetchApiKeys,
  createApiKey,
  updateApiKey,
  revokeApiKey,
} as const;
