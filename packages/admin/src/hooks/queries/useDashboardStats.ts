/**
 * Dashboard Statistics Query Hook
 *
 * TanStack Query hook for fetching dashboard statistics from the real
 * GET /api/dashboard/stats endpoint.
 *
 * @module hooks/queries/useDashboardStats
 */

import { useQuery } from "@tanstack/react-query";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { DashboardStats } from "@admin/types/dashboard/stats";

/**
 * useDashboardStats Hook
 *
 * Fetches and caches dashboard statistics using TanStack Query.
 *
 * **Query Configuration**:
 * - `queryKey`: `["dashboard", "stats"]` - Used for caching and invalidation
 * - `staleTime`: 5 minutes - Data considered fresh for 5 minutes
 * - `gcTime`: 10 minutes - Cache kept in memory for 10 minutes
 * - `retry`: 2 - Retry failed requests twice before showing error
 * - `refetchOnWindowFocus`: true - Refetch when window regains focus
 *
 * @returns TanStack Query result with dashboard stats
 */
export function useDashboardStats() {
  return useQuery<DashboardStats, Error>({
    queryKey: ["dashboard", "stats"],
    queryFn: () => protectedApi.get<DashboardStats>("/dashboard/stats"),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    retry: 2,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}
