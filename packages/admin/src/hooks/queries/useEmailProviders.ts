/**
 * Email Provider Query Hooks
 *
 * TanStack Query hooks for email provider CRUD operations.
 * Used by the Settings > Email Providers pages.
 *
 * Query Keys:
 * - `["emailProviders"]` — base key for invalidation
 * - `["emailProviders", "list", params]` — paginated/filtered list
 * - `["emailProviders", "detail", id]` — single provider
 *
 * @example
 * ```ts
 * const { data, isLoading } = useEmailProviders({ page: 0, pageSize: 10, search: '' });
 * const { data: provider } = useEmailProvider('provider-id');
 * const { mutate: create } = useCreateEmailProvider();
 * ```
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import {
  listProviders,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
  setDefaultProvider,
  testProvider,
  type EmailProviderRecord,
  type EmailProviderListResponse,
  type CreateEmailProviderPayload,
  type UpdateEmailProviderPayload,
  type TestProviderResult,
} from "@admin/services/emailProviderApi";

// ============================================================
// Query Key Factory
// ============================================================

export const emailProviderKeys = {
  all: () => ["emailProviders"] as const,
  lists: () => [...emailProviderKeys.all(), "list"] as const,
  list: (params: {
    page: number;
    pageSize: number;
    search: string;
    type?: string;
  }) => [...emailProviderKeys.lists(), params] as const,
  details: () => [...emailProviderKeys.all(), "detail"] as const,
  detail: (id: string) => [...emailProviderKeys.details(), id] as const,
};

// ============================================================
// Query Hooks
// ============================================================

/**
 * useEmailProviders — Fetch paginated email provider list.
 */
export function useEmailProviders(
  params: { page: number; pageSize: number; search: string; type?: string },
  options?: Omit<
    UseQueryOptions<EmailProviderListResponse, Error>,
    "queryKey" | "queryFn"
  >
) {
  return useQuery<EmailProviderListResponse, Error>({
    queryKey: emailProviderKeys.list(params),
    // Admin-internal field name `pageSize` maps to canonical wire option
    // `limit`. TableParams.pagination.pageSize stays as the admin-internal
    // React state name (the user's selected dropdown value) per the
    // Phase 4.7 boundary documented in packages/ui/src/types/table.ts.
    queryFn: () =>
      listProviders({
        page: params.page,
        limit: params.pageSize,
        search: params.search,
        type: params.type as Parameters<typeof listProviders>[0]["type"],
      }),
    ...options,
  });
}

/**
 * useEmailProvider — Fetch a single email provider by ID.
 * Only runs when `id` is provided (truthy).
 */
export function useEmailProvider(
  id?: string,
  options?: Omit<
    UseQueryOptions<EmailProviderRecord, Error>,
    "queryKey" | "queryFn" | "enabled"
  >
) {
  return useQuery<EmailProviderRecord, Error>({
    queryKey: emailProviderKeys.detail(id!),
    queryFn: () => {
      if (!id) throw new Error("Provider ID is required");
      return getProvider(id);
    },
    enabled: !!id,
    ...options,
  });
}

// ============================================================
// Mutation Hooks
// ============================================================

/**
 * useCreateEmailProvider — Create a new email provider.
 * Invalidates all provider queries on success.
 */
export function useCreateEmailProvider() {
  const queryClient = useQueryClient();

  return useMutation<EmailProviderRecord, Error, CreateEmailProviderPayload>({
    mutationFn: data => createProvider(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: emailProviderKeys.all() });
    },
  });
}

/**
 * useUpdateEmailProvider — Update an existing email provider.
 * Invalidates all provider queries on success.
 */
export function useUpdateEmailProvider() {
  const queryClient = useQueryClient();

  return useMutation<
    EmailProviderRecord,
    Error,
    { id: string; data: UpdateEmailProviderPayload }
  >({
    mutationFn: ({ id, data }) => updateProvider(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: emailProviderKeys.all() });
    },
  });
}

/**
 * useDeleteEmailProvider — Delete an email provider.
 * Uses optimistic updates to immediately remove the provider from the UI.
 */
export function useDeleteEmailProvider() {
  const queryClient = useQueryClient();

  return useMutation<
    void,
    Error,
    string,
    { previousProviders?: EmailProviderRecord[] }
  >({
    mutationFn: id => deleteProvider(id),
    // Optimistically remove the provider from the cache before the API call completes
    onMutate: async deletedId => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: emailProviderKeys.lists() });

      // Snapshot the previous value
      const previousProviders = queryClient.getQueryData<EmailProviderRecord[]>(
        emailProviderKeys.lists()
      );

      // Optimistically update to the new value
      if (previousProviders) {
        queryClient.setQueryData<EmailProviderRecord[]>(
          emailProviderKeys.lists(),
          previousProviders.filter(provider => provider.id !== deletedId)
        );
      }

      // Return context object with the snapshotted value
      return { previousProviders };
    },
    // If the mutation fails, use the context returned from onMutate to roll back
    onError: (_err, _deletedId, context) => {
      if (context?.previousProviders) {
        queryClient.setQueryData(
          emailProviderKeys.lists(),
          context.previousProviders
        );
      }
    },
    // Always refetch after error or success to ensure consistency
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: emailProviderKeys.all() });
    },
  });
}

/**
 * useSetDefaultProvider — Set a provider as the default.
 * Invalidates all provider queries on success.
 */
export function useSetDefaultProvider() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: id => setDefaultProvider(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: emailProviderKeys.all() });
    },
  });
}

/**
 * useTestProvider — Send a test email via the specified provider.
 * Mutation variable: `{ id, email? }` — email is the destination address.
 */
export function useTestProvider() {
  return useMutation<TestProviderResult, Error, { id: string; email?: string }>(
    {
      mutationFn: ({ id, email }) => testProvider(id, email),
    }
  );
}
