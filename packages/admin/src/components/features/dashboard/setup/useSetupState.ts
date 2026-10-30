"use client";

/**
 * What the setup card writes for its reader: collapsed or expanded, dismissed
 * or resumed, and a skippable step skipped or restored.
 *
 * Kept on the server per reader (`/api/dashboard/setup`), so it follows them
 * across devices, and never in the layout, whose row means "arranged". Each
 * write asks again for what it changes: the card's own data after a skip or a
 * collapse, and the layout after a dismissal, whose read then leaves the card
 * out (its `shows` says no).
 *
 * @module components/features/dashboard/setup/useSetupState
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SkippableSetupStepKind } from "nextly/config";
import { useCallback } from "react";

import { DASHBOARD_LAYOUT_KEY } from "@admin/hooks/queries/useDashboardLayout";
import { protectedApi } from "@admin/lib/api/protectedApi";

const SETUP_PATH = "/dashboard/setup";

/** One change, as the route takes it. */
export type SetupChange =
  | { collapsed: boolean }
  | { dismissed: boolean }
  | { skip: { kind: SkippableSetupStepKind; skipped: boolean } };

export interface SetupStateWrite {
  setCollapsed: (collapsed: boolean) => void;
  dismiss: () => void;
  setSkipped: (kind: SkippableSetupStepKind, skipped: boolean) => void;
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
      if ("dismissed" in change) {
        void queryClient.invalidateQueries({ queryKey: DASHBOARD_LAYOUT_KEY });
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
  return {
    setCollapsed,
    dismiss,
    setSkipped,
    isWriting: mutation.isPending,
    failed: mutation.isError
      ? "That change could not be saved. Try again."
      : undefined,
  };
}
