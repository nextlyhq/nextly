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
import { isOnboardingStepId, type OnboardingStepId } from "nextly/config";
import { useEffect, useRef } from "react";

import { useSchemaUpdateInvalidation } from "@admin/hooks/useSchemaUpdateInvalidation";
import { protectedApi } from "@admin/lib/api/protectedApi";

import { DASHBOARD_LAYOUT_KEY } from "./useDashboardLayout";

/**
 * The ids core detects, IMPORTED rather than restated.
 *
 * 🔴 This union was spelled out here, and that made the card's exhaustive
 * presentation map a promise it could not keep: a step added to core compiled
 * fine, arrived over the wire as an id the map had no entry for, and the row
 * was drawn by destructuring `undefined`. A union written twice is not a
 * contract between two packages, it is a coincidence with an expiry date.
 */
export type { OnboardingStepId } from "nextly/config";

export interface OnboardingStepState {
  id: OnboardingStepId;
  complete: boolean;
}

interface OnboardingResponse {
  steps: unknown;
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

/**
 * The steps this build can draw, and whether anything was left out.
 *
 * 🔴 The count matters as much as the rows. Dropping an unreadable row keeps
 * the card from crashing, and on its own it introduces a worse failure: a newer
 * server sending an INCOMPLETE step this build cannot name would leave every
 * remaining row complete, so the card would report 100%, announce itself
 * finished, and ask the host to drop it -- while the host went on offering it
 * for the step that was dropped. A checklist claiming completion it cannot see
 * is the one thing worse than one that cannot draw.
 */
function readSteps(value: unknown): {
  steps: OnboardingStepState[];
  rejected: boolean;
} {
  if (!Array.isArray(value)) return { steps: [], rejected: false };
  const steps: OnboardingStepState[] = [];
  let rejected = false;
  for (const raw of value) {
    const row = readStep(raw);
    if (row) steps.push(row);
    else rejected = true;
  }
  return { steps, rejected };
}

/** One row, or nothing when this build cannot describe it. */
function readStep(raw: unknown): OnboardingStepState | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { id, complete } = raw as { id?: unknown; complete?: unknown };
  if (!isOnboardingStepId(id) || typeof complete !== "boolean")
    return undefined;
  return { id, complete };
}

export function useOnboardingSteps(): UseOnboardingStepsResult {
  const queryClient = useQueryClient();
  // Two of the three steps are answered from the collection registry, so a
  // schema change moves them. The layout query already subscribes to this; this
  // one did not, so creating a collection in another tab -- or through a
  // code-first reload -- left the card still saying "Create a collection" until
  // the window regained focus.
  useSchemaUpdateInvalidation(ONBOARDING_STEPS_KEY);

  const query = useQuery<OnboardingResponse>({
    queryKey: ONBOARDING_STEPS_KEY,
    queryFn: () =>
      protectedApi.get<OnboardingResponse>("/dashboard/onboarding"),
    retry: false,
    /*
     * 🔴 Overrides the provider's five-minute default, and the card does not
     * work without it. This answer changes when the reader creates a collection
     * or writes their first entry -- things they do elsewhere in the admin,
     * often seconds before returning here -- and the provider also disables
     * focus refetching, so an answer held fresh is not refreshed by coming back
     * to the tab either.
     *
     * The case that makes it sharp: the card is unmounted whenever it is not
     * offered, and the cached answer outlives that by ten minutes. A reader who
     * finishes onboarding and then deletes their last collection is offered the
     * card again -- and a cached answer still counted fresh means it draws
     * every row ticked, while the host is offering it precisely because a row
     * is not.
     *
     * Cheap: this query only mounts while onboarding is outstanding.
     */
    staleTime: 0,
  });

  // Guarded at the boundary rather than trusted. The response is JSON, so the
  // shared type says nothing at runtime -- and admin and core version in
  // lockstep only until someone runs a newer server against an older admin. An
  // id this build cannot draw is DROPPED rather than rendered, because the
  // alternative is a row built from an absent presentation entry.
  const { steps, rejected } = readSteps(query.data?.steps);
  const completedCount = steps.filter(step => step.complete).length;
  const totalCount = steps.length;
  // A rejected row means the checklist this build can see is not the checklist
  // the host has, so completeness cannot be concluded from what is left.
  const finished = !rejected && totalCount > 0 && completedCount === totalCount;

  // Finishing the last step is the moment the card stops being offered, and
  // the layout query neither polls nor refetches except on focus -- so without
  // this the reader ticks the final row and the card sits there until they
  // navigate away. Fired ONCE per mount: the invalidation drops the card and
  // unmounts this hook, and a guardless effect would re-invalidate on every
  // render for as long as anything kept it alive.
  const dropped = useRef(false);
  // 🔴 Only data fetched during THIS mount may ask the host to drop the card.
  //
  // The card is unmounted whenever it is not offered, and a cached response
  // outlives that. So a reader who finishes onboarding, then deletes their last
  // collection, gets the card offered again -- and it would remount holding the
  // previous mount's all-complete answer, announce itself finished before its
  // own refetch landed, and ask for a layout the server has just decided should
  // include it. One spurious round trip, and a card that flickers away from a
  // reader who needs it.
  //
  // Compared against the MOUNT rather than trusting `isStale`. With
  // `staleTime: 0` above, data is stale the instant it arrives, so that flag
  // cannot separate "not yet refetched" from "just fetched" -- and it is the
  // refetch this has to wait for, not the staleness.
  const mountedAt = useRef(Date.now());
  useEffect(() => {
    if (!finished || dropped.current) return;
    if (query.dataUpdatedAt < mountedAt.current) return;
    dropped.current = true;
    void queryClient.invalidateQueries({ queryKey: DASHBOARD_LAYOUT_KEY });
  }, [finished, query.dataUpdatedAt, queryClient]);

  return {
    steps,
    completedCount,
    totalCount,
    isPending: query.isPending,
    // A row this build could not read leaves the card unable to describe the
    // reader's progress, which is the same position a failed request leaves it
    // in -- and both are better said than guessed at.
    isUnavailable: query.isError || rejected,
  };
}
