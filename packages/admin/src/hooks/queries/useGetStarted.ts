"use client";

/**
 * The Get started steps for the card that draws them, from the layout read.
 *
 * The steps travel in the layout read, from the same computation that decided whether the card
 * is drawn, so this reads the grid's own query rather than an endpoint of its own: the card and
 * the arrangement it sits in are always one answer. A removed card has no steps in that read;
 * restored in customise mode, it is drawn before the save that restores it, so its steps are
 * asked for then (`?getStarted=1`).
 *
 * @module hooks/queries/useGetStarted
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GetStartedAnswer } from "nextly/config";
import { useCallback } from "react";

import {
  DASHBOARD_LAYOUT_KEY,
  fetchDashboardLayout,
  fetchGetStartedOnRestore,
} from "./useDashboardLayout";

/** Under the layout key, so whatever reads the layout again reads this again too. */
const ON_RESTORE_KEY = [...DASHBOARD_LAYOUT_KEY, "get-started"] as const;

export interface UseGetStartedResult {
  /** The steps, or `undefined` until they are known. */
  answer: GetStartedAnswer | undefined;
  isPending: boolean;
  /** The read failed: the card says it could not check setup and offers Retry. */
  isUnavailable: boolean;
  /** Reads the layout again, and the steps with it. */
  retry: () => void;
  /**
   * Whether the reader has acted on this card, as its stored settings say. Read from the
   * layout's placement, since the card declares no settings for the frame to resolve.
   */
  acted: boolean;
}

export function useGetStarted(placementId: string): UseGetStartedResult {
  const queryClient = useQueryClient();
  const layout = useQuery({
    queryKey: DASHBOARD_LAYOUT_KEY,
    queryFn: fetchDashboardLayout,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const inLayout = layout.data?.getStarted?.answer ?? undefined;
  // Asked only when the layout read holds no steps for a card that is being drawn.
  const asksOnRestore = layout.isSuccess && inLayout === undefined;
  const onRestore = useQuery({
    queryKey: ON_RESTORE_KEY,
    queryFn: fetchGetStartedOnRestore,
    enabled: asksOnRestore,
    staleTime: 0,
  });
  const restored = onRestore.data?.getStarted?.answer ?? undefined;

  const retry = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: DASHBOARD_LAYOUT_KEY });
  }, [queryClient]);

  const answer = inLayout ?? restored;
  const config = layout.data?.placements.find(
    p => p.id === placementId
  )?.config;
  const isUnavailable =
    answer === undefined && (layout.isError || onRestore.isError);
  return {
    acted: config?.acted === true,
    answer,
    // A query that is not enabled reports itself pending, so the restore read counts only when
    // it is asked, and a failure is never also "loading".
    isPending:
      answer === undefined &&
      !isUnavailable &&
      (layout.isPending || (asksOnRestore && onRestore.isPending)),
    isUnavailable,
    retry,
  };
}
