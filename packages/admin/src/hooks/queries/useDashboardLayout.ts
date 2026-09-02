/**
 * One reader's dashboard arrangement, and the two guards a write must echo.
 *
 * `GET /api/dashboard/layout` answers the arrangement RESOLVED against the live
 * registry — placements whose widget no longer exists, or whose permission this
 * caller lacks, are already gone — plus `available`, the widgets they may see
 * and have not placed.
 *
 * ## Why a write echoes two things and not one
 *
 * `version` guards the ROW: another tab saved first. `scope` guards the FILTER
 * that shaped what this client was shown: a permission grant, a role change or
 * a plugin registering elsewhere moves the visible set without touching the
 * row, so `version` still matches while the snapshot in hand is stale. A
 * mismatch on either is a 409, and the remedy for both is identical — re-read.
 * That is why this hook exposes one `conflict` flag rather than two: a caller
 * that had to tell them apart would be a caller with two recovery paths, and
 * there is only one.
 *
 * ## Why saving invalidates rather than writing through
 *
 * The response echoes what was submitted, not what was stored — the server
 * merges back placements this caller was never shown, and deliberately does not
 * disclose them. Seeding the cache from the response would therefore be seeding
 * it with a deliberately partial answer. Invalidating costs one round trip and
 * keeps the client's copy the server's copy.
 *
 * @module hooks/queries/useDashboardLayout
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { useCallback } from "react";

import { useSchemaUpdateInvalidation } from "@admin/hooks/useSchemaUpdateInvalidation";
import { protectedApi } from "@admin/lib/api/protectedApi";
import type {
  DashboardLayoutResponse,
  WidgetPlacement,
} from "@admin/types/dashboard/widgets";

/** The one query key this feature owns, so a save can invalidate exactly it. */
export const DASHBOARD_LAYOUT_KEY = ["dashboard", "layout"] as const;

const LAYOUT_PATH = "/dashboard/layout";

/** What a save sends. Both guards, always — neither is optional server-side. */
export interface SaveLayoutInput {
  placements: WidgetPlacement[];
  version: number;
  scope: string;
}

export interface UseDashboardLayoutResult {
  layout: DashboardLayoutResponse | undefined;
  isPending: boolean;
  /**
   * Whether the arrangement could not be read at all.
   *
   * Distinct from an empty one: a reader with no widgets and a reader whose
   * request failed both hold zero placements, and only the second is a fault.
   */
  isUnavailable: boolean;
  save: UseMutationResult<unknown, Error, SaveLayoutInput>;
  reset: UseMutationResult<unknown, Error, void>;
  /**
   * Whether the last write lost a race — on EITHER guard.
   *
   * One flag for two causes because the recovery is one action. The server
   * authors both messages and both end "Reload and try again."
   */
  isConflict: boolean;
  /**
   * A write that failed for any OTHER reason, as something to show the reader.
   *
   * Separate from `isConflict` because the remedies differ: a conflict is
   * recovered by reloading, a network error or a 500 by trying again. Reported
   * at all because it previously was not — only conflicts were rendered, so a
   * failed save left the reader in edit mode with the spinner stopped and
   * nothing said, believing their arrangement had been stored.
   */
  writeError: Error | null;
  reload: () => Promise<unknown>;
}

/** Whether a failed write was a lost race rather than a broken request. */
function isConflictError(error: Error | null): boolean {
  if (!error) return false;
  // The status is what the server actually distinguishes on; the message is
  // human copy that may be translated or reworded. Read the code where one is
  // available and fall back to the status only.
  const status = (error as { status?: number }).status;
  const code = (error as { code?: string }).code;
  return status === 409 || code === "CONFLICT";
}

/** The first failure that is NOT a lost race, or `null`. */
function nonConflictError(...errors: Array<Error | null>): Error | null {
  return errors.find(error => error && !isConflictError(error)) ?? null;
}

export function useDashboardLayout(): UseDashboardLayoutResult {
  const queryClient = useQueryClient();

  // A schema change moves what this endpoint answers: a collection created a
  // moment ago has cards to OFFER, and one just deleted no longer does. Nothing
  // else invalidates this key — `refetchOnWindowFocus` is the only other route,
  // so a dashboard left open would keep a picker that cannot add the new card
  // and still offers the removed one, whose save is then refused.
  useSchemaUpdateInvalidation(DASHBOARD_LAYOUT_KEY);

  const query = useQuery({
    queryKey: DASHBOARD_LAYOUT_KEY,
    queryFn: () => protectedApi.get<DashboardLayoutResponse>(LAYOUT_PATH),
    // Matching `useDashboardStats` and `useWidgetQueries`: fresh on mount and
    // on focus, and NO polling. An arrangement that rearranges itself while
    // somebody is reading it is worse than a stale one.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: DASHBOARD_LAYOUT_KEY }),
    [queryClient]
  );

  const save = useMutation({
    mutationFn: (input: SaveLayoutInput) =>
      protectedApi.put<unknown>(LAYOUT_PATH, input),
    // 🔴 No retries, against the provider's default of two. A version-guarded
    // write is not idempotent under an AMBIGUOUS failure: if the server commits
    // and the response is lost, the retry sends the same now-stale version, the
    // server refuses it, and the reader is told another editor changed their
    // dashboard — when in fact their own save had already succeeded. The retry
    // manufactures the exact conflict the guard exists to report truthfully.
    retry: false,
    onSuccess: invalidate,
  });

  const reset = useMutation({
    mutationFn: () => protectedApi.delete<unknown>(LAYOUT_PATH),
    // Idempotent by design — deleting a row that is already gone is the same
    // answer — but retried silently it would still hide a server that is
    // failing, and the reader would watch a spinner rather than a message.
    retry: false,
    onSuccess: invalidate,
  });

  return {
    layout: query.data,
    isPending: query.isPending,
    // A cached answer that a BACKGROUND refetch failed over is still a usable
    // answer, so only an error with nothing to show counts as unavailable.
    isUnavailable: query.isError && query.data === undefined,
    save,
    reset,
    isConflict:
      isConflictError(save.error ?? null) ||
      isConflictError(reset.error ?? null),
    writeError: nonConflictError(save.error ?? null, reset.error ?? null),
    reload: invalidate,
  };
}
