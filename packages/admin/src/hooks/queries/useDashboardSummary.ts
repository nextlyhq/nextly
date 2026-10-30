/**
 * The dashboard header's summary for the signed-in reader, from
 * `GET /api/dashboard/summary`. Refreshed as the cards are: on mount and when
 * the window regains focus, since each part repeats a card's count; and with
 * the layout on every layout write (`useDashboardLayout`), since a part counts
 * for a card on the dashboard.
 *
 * @module hooks/queries/useDashboardSummary
 */

import type { UseQueryResult } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { DashboardSummary } from "@admin/types/dashboard/summary";

export const DASHBOARD_SUMMARY_KEY = ["dashboard", "summary"] as const;

export function useDashboardSummary(): UseQueryResult<DashboardSummary, Error> {
  return useQuery<DashboardSummary, Error>({
    queryKey: DASHBOARD_SUMMARY_KEY,
    queryFn: () => protectedApi.get<DashboardSummary>("/dashboard/summary"),
    staleTime: 0,
    retry: 1,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}
