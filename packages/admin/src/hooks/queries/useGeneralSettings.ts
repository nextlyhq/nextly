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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
export function useGeneralSettings() {
  return useQuery<GeneralSettingsRecord, Error>({
    queryKey: generalSettingsKeys.all(),
    queryFn: getGeneralSettings,
    gcTime: 0, // Immediately clear from cache when component unmounts
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
export function useUpdateGeneralSettings() {
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
