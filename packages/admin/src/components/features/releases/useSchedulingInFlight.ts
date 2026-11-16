/**
 * Whether a request to schedule this document is still out.
 *
 * Read from the mutation cache, under the key every send for the document
 * runs with, rather than from the dialog that sent it. The page outlives a
 * move to another document and back, and the dialog does not: a move closes
 * it, and choosing the action again mounts a new one. A lock held in the
 * dialog would be gone on return while the first request is still out, and
 * the step makes a new release each time it is asked, so a second send
 * would schedule the document twice.
 *
 * Kept apart from the release hooks so the editor, which loads this before
 * anyone asks to schedule, does not load them with it.
 *
 * @module components/features/releases/useSchedulingInFlight
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";

import { releaseKeys } from "@admin/hooks/queries/release-keys";
import type { ReleaseDocumentRef } from "@admin/types/releases";

export interface SchedulingInFlight {
  /** As of this render: what the page draws. */
  inFlight: boolean;
  /**
   * As of this moment: what a send checks. A second press can land before
   * the page draws the first one's request, and only the cache knows of it
   * by then.
   */
  inFlightNow: () => boolean;
}

/**
 * The document asked about. Its slug and id may still be loading, as a hook
 * is called before the page knows them: no request is ever sent for an empty
 * slug or id, so the empty key they stand as then matches nothing.
 */
type DocumentAskedAbout = Pick<ReleaseDocumentRef, "scopeKind"> &
  Partial<Pick<ReleaseDocumentRef, "scopeSlug" | "entryId">>;

export function useSchedulingInFlight({
  scopeKind,
  scopeSlug = "",
  entryId = "",
}: DocumentAskedAbout): SchedulingInFlight {
  const queryClient = useQueryClient();
  const inFlightNow = useCallback(
    () =>
      queryClient.isMutating({
        mutationKey: releaseKeys.scheduling({ scopeKind, scopeSlug, entryId }),
      }) > 0,
    [queryClient, scopeKind, scopeSlug, entryId]
  );
  const subscribe = useCallback(
    (onChange: () => void) =>
      queryClient.getMutationCache().subscribe(() => onChange()),
    [queryClient]
  );
  // Asked of the cache on every render as well as on its every change, so a
  // move to another document reads that document's answer at once. A
  // snapshot kept until the cache next changes would still be the last
  // document's.
  const inFlight = useSyncExternalStore(subscribe, inFlightNow, () => false);
  return { inFlight, inFlightNow };
}
