/**
 * Dashboard Recent Entries Query Hook
 *
 * TanStack Query hook for fetching recently edited entries from the
 * GET /api/dashboard/recent-entries endpoint.
 *
 * @module hooks/queries/useRecentEntries
 */

import { useQuery } from "@tanstack/react-query";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { RecentEntriesResponse } from "@admin/types/dashboard/recent-entries";

/**
 * useRecentEntries Hook
 *
 * Fetches the most recently edited entries across all collections.
 *
 * @param limit - Number of entries to fetch (default: 5)
 * @returns TanStack Query result with recent entries
 */
export function useRecentEntries(limit: number = 5) {
  return useQuery<RecentEntriesResponse, Error>({
    queryKey: ["dashboard", "recent-entries", limit],
    queryFn: () =>
      protectedApi.get<RecentEntriesResponse>(
        `/dashboard/recent-entries?limit=${limit}`
      ),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}
