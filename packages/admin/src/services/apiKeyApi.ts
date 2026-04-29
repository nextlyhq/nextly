/**
 * API Key API Service
 *
 * API client for managing API keys. Supports listing, creating, updating,
 * and revoking keys.
 *
 * Note: The API key backend returns single-wrapped responses
 * (`{ data: ... }` / `{ doc, key }` / `{ success }`) rather than the
 * double-wrapped shape (`{ data: { data: ... } }`) expected by
 * `enhancedFetcher`. This service uses a raw internal fetch helper so
 * every response shape is read precisely as the backend sends it.
 *
 * @example
 * ```ts
 * import { apiKeyApi } from '@admin/services/apiKeyApi';
 *
 * const { data, meta } = await apiKeyApi.fetchApiKeys();
 * const { doc, key } = await apiKeyApi.createApiKey({ name: 'CI Key', tokenType: 'read-only', expiresIn: '30d' });
 * ```
 */

import { BASE_URL } from "../lib/api/fetcher";
import { parseApiError } from "../lib/api/parseApiError";
import { authFetch } from "../lib/api/refreshInterceptor";

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
// Internal fetch helper
// ============================================================

/**
 * Thin authenticated fetch wrapper for the API key endpoints.
 *
 * Returns the full parsed JSON (canonical wire shape `{ data, meta? }` per
 * spec §10.2) so each caller can pick the field shape its endpoint emits —
 * `data` for single docs, `data` + `meta` for paginated lists.
 *
 * Uses the shared `parseApiError` for consistent error handling.
 */
async function apiKeyFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await authFetch(`${BASE_URL}${path}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    credentials: "include",
    ...options,
  });

  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw parseApiError(json, res.status);
  }

  return res.json() as Promise<T>;
}

// ============================================================
// API Functions
// ============================================================

/**
 * List all API keys visible to the authenticated user.
 *
 * Super-admins see keys across all users. Regular users see only their own.
 */
export async function fetchApiKeys(): Promise<ApiKeyListResponse> {
  const json = await apiKeyFetch<{ data: ApiKeyMeta[]; meta: ApiKeyListMeta }>(
    "/api-keys"
  );
  return { data: json.data, meta: json.meta };
}

/**
 * Create a new API key.
 *
 * Session-only — cannot be called via an existing API key.
 * The raw `key` in the result is shown exactly once; it is never stored
 * and cannot be retrieved again.
 */
export async function createApiKey(
  input: CreateApiKeyPayload
): Promise<CreateApiKeyResult> {
  // Canonical wire shape per spec §10.2: route returns { data: { doc, key } }.
  // Reading the top-level json.doc / json.key (the legacy shape) leaves the
  // reveal modal blank — the raw key is shown exactly once and cannot be
  // recovered, so this fix is critical (handoff F12 HIGH IMPACT).
  const json = await apiKeyFetch<{ data: CreateApiKeyResult }>("/api-keys", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return { doc: json.data.doc, key: json.data.key };
}

/**
 * Update the name or description of an existing API key.
 *
 * Token type, role, and duration are immutable — revoke and recreate to
 * change them. Session-only.
 */
export async function updateApiKey(
  id: string,
  input: UpdateApiKeyPayload
): Promise<ApiKeyMeta> {
  const json = await apiKeyFetch<{ data: ApiKeyMeta }>(`/api-keys/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return json.data;
}

/**
 * Revoke (soft-delete) an API key.
 *
 * Sets `isActive = false`. The row is preserved for audit purposes.
 * Session-only.
 */
export async function revokeApiKey(id: string): Promise<void> {
  await apiKeyFetch<{ success: true }>(`/api-keys/${id}`, {
    method: "DELETE",
  });
}

export const apiKeyApi = {
  fetchApiKeys,
  createApiKey,
  updateApiKey,
  revokeApiKey,
} as const;
