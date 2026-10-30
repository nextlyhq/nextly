"use client";

/**
 * What the setup card writes for its reader: collapsed or expanded, dismissed
 * or resumed, and a skippable step skipped or restored.
 *
 * Kept on the server per reader (`/api/dashboard/setup`), so it follows them
 * across devices, and never in the layout, whose row means "arranged". Each
 * write asks again for what it changes: the card's own data after a skip or a
 * collapse, and the layout after a dismissal, whose read then leaves the card
 * out (its `shows` says no). A retirement asks for nothing: the card already
 * says "You're all set", and the next layout read leaves it out.
 *
 * @module components/features/dashboard/setup/useSetupState
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SampleRoute, SkippableSetupStepKind } from "nextly/config";
import { useCallback } from "react";

import { DASHBOARD_LAYOUT_KEY } from "@admin/hooks/queries/useDashboardLayout";
import { protectedApi } from "@admin/lib/api/protectedApi";

import { DASHBOARD_SETUP_KEY } from "./useSetupResume";

const SETUP_PATH = "/dashboard/setup";

/** One change, as the route takes it. */
type SetupChange =
  | { collapsed: boolean }
  | { dismissed: boolean }
  | { skip: { kind: SkippableSetupStepKind; skipped: boolean } }
  | { retire: SampleRoute };

export interface SetupStateWrite {
  setCollapsed: (collapsed: boolean) => void;
  dismiss: () => void;
  setSkipped: (kind: SkippableSetupStepKind, skipped: boolean) => void;
  /**
   * Asks the host to record "You're all set" over the steps this card draws,
   * with what the project's sample-content route said: only the admin can ask
   * it. The host judges the steps again and records only what it finds done.
   */
  retire: (route: SampleRoute) => void;
  isWriting: boolean;
  /** The last write that failed, said in words; cleared by the next write. */
  failed: string | undefined;
}

/**
 * The card's writes. `refresh` asks for the card's data again: the frame's own
 * retry, which re-runs its `load`.
 */
export function useSetupState(refresh: () => void): SetupStateWrite {
  const queryClient = useQueryClient();
  const mutation = useMutation<unknown, Error, SetupChange>({
    mutationFn: change => protectedApi.put(SETUP_PATH, change),
    onSuccess: (_answer, change) => {
      if ("retire" in change) return;
      if ("dismissed" in change) {
        void queryClient.invalidateQueries({ queryKey: DASHBOARD_LAYOUT_KEY });
        // The header's "Resume setup" is offered from this answer.
        void queryClient.invalidateQueries({ queryKey: DASHBOARD_SETUP_KEY });
        return;
      }
      refresh();
    },
  });
  const { mutate } = mutation;
  const setCollapsed = useCallback(
    (collapsed: boolean) => mutate({ collapsed }),
    [mutate]
  );
  const dismiss = useCallback(() => mutate({ dismissed: true }), [mutate]);
  const setSkipped = useCallback(
    (kind: SkippableSetupStepKind, skipped: boolean) =>
      mutate({ skip: { kind, skipped } }),
    [mutate]
  );
  const retire = useCallback(
    (route: SampleRoute) => mutate({ retire: route }),
    [mutate]
  );
  return {
    setCollapsed,
    dismiss,
    setSkipped,
    retire,
    isWriting: mutation.isPending,
    failed: mutation.isError
      ? "That change could not be saved. Try again."
      : undefined,
  };
}
