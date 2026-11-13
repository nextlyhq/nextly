/**
 * General Settings Query Hooks
 *
 * TanStack Query hooks for general settings CRUD.
 * Used by the Settings > General page.
 *
 * Query Keys:
 * - `["generalSettings"]` — singleton query key
 *
 * @module hooks/queries/useGeneralSettings
 * @since 1.0.0
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuthSession } from "@admin/hooks/queries/useAuthSession";
import {
  getGeneralSettings,
  updateGeneralSettings,
  type GeneralSettingsRecord,
  type UpdateGeneralSettingsPayload,
} from "@admin/services/generalSettingsApi";

// ============================================================
// Query Key Factory
// ============================================================

export const generalSettingsKeys = {
  all: () => ["generalSettings"] as const,
};

// ============================================================
// Query Hooks
// ============================================================

/**
 * useGeneralSettings — Fetch the current general settings.
 *
 * **Critical Behavior:**
 * - Always makes a fresh API call when the hook mounts/page loads
 * - gcTime: 0 ensures no caching between page navegations
 * - Forces fetch on every component mount
 *
 * This prevents stale data from showing when navigating away/back.
 */
export function useGeneralSettings(): UseQueryResult<
  GeneralSettingsRecord,
  Error
> {
  // Asked only of a signed-in session. The route answers a visitor 401, so on
  // the sign-in screen the request could only be refused, and a refused query
  // is asked again by every reader that mounts after the refusal arrived
  // (TanStack Query's `retryOnMount`), which the screen's own re-renders do.
  // Until the session is known nothing is asked either: `isPending` stays true
  // meanwhile, so a reader waiting for the settings keeps waiting.
  const { data: session } = useAuthSession();
  return useQuery<GeneralSettingsRecord, Error>({
    queryKey: generalSettingsKeys.all(),
    queryFn: getGeneralSettings,
    gcTime: 0, // Immediately clear from cache when component unmounts
    enabled: session?.isAuthenticated === true,
  });
}

// ============================================================
// Mutation Hooks
// ============================================================

/**
 * useUpdateGeneralSettings — Update the general settings.
 * Immediately updates the query cache with the response data, ensuring
 * the UI reflects changes without waiting for a refetch.
 */
export function useUpdateGeneralSettings(): UseMutationResult<
  GeneralSettingsRecord,
  Error,
  UpdateGeneralSettingsPayload,
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation<
    GeneralSettingsRecord,
    Error,
    UpdateGeneralSettingsPayload
  >({
    mutationFn: data => updateGeneralSettings(data),
    onSuccess: data => {
      // Immediately update the cache with the new data
      queryClient.setQueryData(generalSettingsKeys.all(), data);
    },
  });
}
