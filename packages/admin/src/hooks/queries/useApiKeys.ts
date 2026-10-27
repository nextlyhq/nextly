"use client";

/**
 * API Key Query Hooks
 *
 * TanStack Query hooks for API key CRUD and revocation operations.
 * Used by the Settings > API Keys pages.
 *
 * Query Keys:
 * - `["apiKeys"]` — base key for invalidation
 * - `["apiKeys", "list"]` — key list
 *
 * @example
 * ```ts
 * const { data, isLoading } = useApiKeys();
 * const { mutate: create } = useCreateApiKey();
 * const { mutate: update } = useUpdateApiKey();
 * const { mutate: revoke } = useRevokeApiKey();
 * ```
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  fetchApiKeyAbilities,
  fetchApiKeys,
  createApiKey,
  updateApiKey,
  revokeApiKey,
  type ApiKeyAbilitiesQuery,
  type ApiKeyAbility,
  type ApiKeyMeta,
  type ApiKeyListResponse,
  type CreateApiKeyPayload,
  type UpdateApiKeyPayload,
  type CreateApiKeyResult,
  type ApiKeyTokenType,
} from "@admin/services/apiKeyApi";

// ============================================================
// Query Key Factory
// ============================================================

export const apiKeyKeys = {
  all: () => ["apiKeys"] as const,
  lists: (): readonly ["apiKeys", "list"] =>
    [...apiKeyKeys.all(), "list"] as const,
  abilities: (
    query: ApiKeyAbilitiesQuery
  ): readonly ["apiKeys", "abilities", ApiKeyTokenType, string | null] =>
    [
      ...apiKeyKeys.all(),
      "abilities",
      query.tokenType,
      query.roleId ?? null,
    ] as const,
};

// ============================================================
// Query Hooks
// ============================================================

/**
 * useApiKeys — Fetch all API keys visible to the authenticated user.
 *
 * Super-admins see keys across all users; regular users see only their own.
 * Uses a 30-second stale time so the list stays fresh during a settings session
 * without hammering the server on every navigation.
 */
export function useApiKeys(): UseQueryResult<ApiKeyListResponse, Error> {
  return useQuery<ApiKeyListResponse, Error>({
    queryKey: apiKeyKeys.lists(),
    queryFn: () => fetchApiKeys(),
    staleTime: 30_000,
  });
}

/**
 * useApiKeyAbilities — What a key of this type and role would be able to do,
 * as the server answers it, for the form's summary before creation.
 *
 * Asked only once it can be answered: a role-based key needs its role.
 *
 * Asked again while the form is open, every half minute and when the window
 * regains focus. A read-only or full-access key follows its creator's
 * permissions and a role-based one its role, so the answer can change before
 * the key is created; focus refetching is off across the admin and nothing
 * on this screen invalidates the summary, so without this the form would go
 * on showing the old answer while the key it creates gets the new one.
 */
export function useApiKeyAbilities(
  query: ApiKeyAbilitiesQuery
): UseQueryResult<ApiKeyAbility[], Error> {
  return useQuery<ApiKeyAbility[], Error>({
    queryKey: apiKeyKeys.abilities(query),
    queryFn: () => fetchApiKeyAbilities(query),
    enabled: query.tokenType !== "role-based" || Boolean(query.roleId),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
  });
}

// ============================================================
// Mutation Hooks
// ============================================================

/**
 * useCreateApiKey — Create a new API key.
 *
 * The mutation result includes both `doc` (the key metadata) and `key` (the
 * one-time raw secret). The calling component should capture `key` in local
 * state inside `onSuccess` and display it via the reveal modal — it is never
 * retrievable again after this response.
 *
 * Invalidates the keys list on success so the new key appears immediately.
 *
 * @example
 * ```tsx
 * const [rawKey, setRawKey] = useState<string | null>(null);
 * const { mutate: createKey } = useCreateApiKey();
 *
 * createKey(payload, {
 *   onSuccess: ({ key }) => setRawKey(key),
 * });
 * ```
 */
export function useCreateApiKey(): UseMutationResult<
  CreateApiKeyResult,
  Error,
  CreateApiKeyPayload,
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation<CreateApiKeyResult, Error, CreateApiKeyPayload>({
    mutationFn: data => createApiKey(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: apiKeyKeys.all() });
    },
  });
}

/**
 * useUpdateApiKey — Update the name or description of an existing API key.
 *
 * Token type, role, and duration are immutable — revoke and recreate to change
 * them. Invalidates the keys list on success.
 */
export function useUpdateApiKey(): UseMutationResult<
  ApiKeyMeta,
  Error,
  {
    id: string;
    data: UpdateApiKeyPayload;
  },
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation<
    ApiKeyMeta,
    Error,
    { id: string; data: UpdateApiKeyPayload }
  >({
    mutationFn: ({ id, data }) => updateApiKey(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: apiKeyKeys.all() });
    },
  });
}

/**
 * useRevokeApiKey — Revoke (soft-delete) an API key by ID.
 *
 * Sets `isActive = false` on the key. The row is preserved for audit purposes.
 * Invalidates the keys list on success so the revoked key is removed from view.
 */
export function useRevokeApiKey(): UseMutationResult<
  void,
  Error,
  string,
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: id => revokeApiKey(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: apiKeyKeys.all() });
    },
  });
}
