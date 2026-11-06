/**
 * Asks the dashboard's cards and its header summary again, for a change made
 * outside them that their answers depend on: a plugin's card marking a
 * submission read, say, while the dashboard stays open behind the tab the
 * submission opened in. Each card keeps what it shows until its answer
 * arrives, as on a refresh from the header.
 *
 * Neither read polls and opening a background tab need not refocus this one,
 * so without this the card and the header would keep the old answer until
 * something else asked again.
 *
 * @module hooks/queries/useRefreshDashboard
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { DASHBOARD_SUMMARY_KEY } from "./useDashboardSummary";
import { WIDGET_QUERIES_KEY } from "./widget-queries-key";

/** A function that asks every card on the dashboard, and its header summary, again. */
export function useRefreshDashboard(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: WIDGET_QUERIES_KEY });
    void queryClient.invalidateQueries({ queryKey: DASHBOARD_SUMMARY_KEY });
  }, [queryClient]);
}
