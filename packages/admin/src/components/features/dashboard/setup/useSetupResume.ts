"use client";

/**
 * Whether the dashboard header offers "Resume setup", and the write that
 * resumes it.
 *
 * Read from `GET /api/dashboard/setup`, whose `resumable` says the reader
 * dismissed the setup card and it has not yet said "You're all set". Asked
 * only for a super-admin, the one reader the card and its route are for: the
 * route refuses anyone else, so asking for them would only fail on every
 * dashboard load. Resuming un-dismisses the card (`PUT`, the same route),
 * then asks again for the layout, whose read draws the card once more, and for
 * this answer, which then says it is no longer resumable.
 *
 * @module components/features/dashboard/setup/useSetupResume
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { DASHBOARD_LAYOUT_KEY } from "@admin/hooks/queries/useDashboardLayout";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { protectedApi } from "@admin/lib/api/protectedApi";

const SETUP_PATH = "/dashboard/setup";

/** The reader's setup state, as the header reads it. */
export const DASHBOARD_SETUP_KEY = ["dashboard", "setup"] as const;

/** What the route answers that the header reads. */
interface SetupStateAnswer {
  resumable: boolean;
}

export interface SetupResume {
  /** Whether the header offers "Resume setup" now. */
  resumable: boolean;
  resume: () => void;
  isResuming: boolean;
  /** The resume failed: the offer stays, to be pressed again. */
  failed: boolean;
}

export function useSetupResume(): SetupResume {
  const { isSuperAdmin } = useCurrentUserPermissions();
  const queryClient = useQueryClient();
  const read = useQuery<SetupStateAnswer, Error>({
    queryKey: DASHBOARD_SETUP_KEY,
    queryFn: () => protectedApi.get<SetupStateAnswer>(SETUP_PATH),
    enabled: isSuperAdmin,
    // A refusal or a failure offers nothing; asking again would not change
    // what is offered, only delay it.
    retry: false,
  });
  const mutation = useMutation<unknown, Error, void>({
    mutationFn: () => protectedApi.put(SETUP_PATH, { dismissed: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_LAYOUT_KEY });
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_SETUP_KEY });
    },
  });
  const { mutate } = mutation;
  const resume = useCallback(() => mutate(), [mutate]);
  return {
    resumable: isSuperAdmin && read.data?.resumable === true,
    resume,
    isResuming: mutation.isPending,
    failed: mutation.isError,
  };
}
