"use client";

/**
 * The setup steps the HOST says are outstanding, for this reader.
 *
 * Replaces a browser-side derivation. The steps used to be computed here from
 * dashboard stats, which made two problems at once: the same four counts were
 * read in two places and could drift, and the answer was per BROWSER rather
 * than per reader — the same person on a second machine met a checklist they
 * had already finished.
 *
 * The server now answers, and the widget condition that decides whether the
 * card is offered at all is derived from the same call, so the card and the
 * rule cannot disagree.
 *
 * @module hooks/queries/useOnboardingSteps
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { protectedApi } from "@admin/lib/api/protectedApi";

import { DASHBOARD_LAYOUT_KEY } from "./useDashboardLayout";

/** The ids core detects. Presentation for each lives with the card. */
export type OnboardingStepId = "account" | "collection" | "entry";

export interface OnboardingStepState {
  id: OnboardingStepId;
  complete: boolean;
}

interface OnboardingResponse {
  steps: OnboardingStepState[];
}

/** The one query key this feature owns. */
export const ONBOARDING_STEPS_KEY = ["dashboard", "onboarding"] as const;

export interface UseOnboardingStepsResult {
  steps: OnboardingStepState[];
  completedCount: number;
  totalCount: number;
  isPending: boolean;
  /**
   * Whether the read failed, as distinct from returning no steps.
   *
   * A reader with nothing outstanding and a reader whose request failed both
   * hold zero incomplete steps, and only the second is a fault. Without the
   * distinction the card would draw a finished checklist for someone whose
   * progress could not be read at all.
   */
  isUnavailable: boolean;
}

export function useOnboardingSteps(): UseOnboardingStepsResult {
  const queryClient = useQueryClient();
  const query = useQuery<OnboardingResponse>({
    queryKey: ONBOARDING_STEPS_KEY,
    queryFn: () =>
      protectedApi.get<OnboardingResponse>("/dashboard/onboarding"),
    retry: false,
  });

  const steps = query.data?.steps ?? [];
  const completedCount = steps.filter(step => step.complete).length;
  const totalCount = steps.length;
  const finished = totalCount > 0 && completedCount === totalCount;

  // Finishing the last step is the moment the card stops being offered, and
  // the layout query neither polls nor refetches except on focus -- so without
  // this the reader ticks the final row and the card sits there until they
  // navigate away. Fired ONCE per mount: the invalidation drops the card and
  // unmounts this hook, and a guardless effect would re-invalidate on every
  // render for as long as anything kept it alive.
  const dropped = useRef(false);
  useEffect(() => {
    if (!finished || dropped.current) return;
    dropped.current = true;
    void queryClient.invalidateQueries({ queryKey: DASHBOARD_LAYOUT_KEY });
  }, [finished, queryClient]);

  return {
    steps,
    completedCount,
    totalCount,
    isPending: query.isPending,
    isUnavailable: query.isError,
  };
}
