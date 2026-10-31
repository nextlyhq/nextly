/**
 * Marking a version as seen, once for each time one is shown.
 *
 * A version is "shown" once it has arrived and is on screen: chosen and still
 * loading is not shown, and neither is the history list, which names versions
 * without showing any one of them. Showing the same version again after going
 * back to the list is a new showing; a refetch of the one already on screen is
 * not.
 *
 * Best effort: a mark that fails changes nothing the person can see, only
 * where a later "since you last looked" comparison starts, so a failure is
 * not reported over the editor. One refusal is read rather than swallowed: a
 * document whose collection or Single was removed from code refuses every
 * write, the mark among them, so where the editor already knows that no mark
 * is sent, and where it does not, the refusal reads the entity's schema again
 * and the screen turns read-only.
 *
 * @module components/features/versions/useMarkVersionSeen
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { refreshRemovedFromCodeSchema } from "@admin/hooks/queries/removed-from-code-refusal";
import { versionApi, type VersionScope } from "@admin/services/versionApi";

/**
 * @param scope - the document whose history is being read
 * @param scopeId - a stable string naming that document, so a scope object
 *   rebuilt each render is not read as a different document
 * @param shownVersionNo - the version on screen, or null while none is
 * @param options.writesRefused - the document's writes are refused (its
 *   collection or Single was removed from code), so no mark is sent
 */
export function useMarkVersionSeen(
  scope: VersionScope,
  scopeId: string,
  shownVersionNo: number | null,
  options: { writesRefused?: boolean } = {}
): void {
  const queryClient = useQueryClient();
  // Read through refs: `shownKey` alone says when a showing starts, and a
  // scope object rebuilt for the same document is not a new one.
  const scopeRef = useRef(scope);
  const versionRef = useRef(shownVersionNo);
  scopeRef.current = scope;
  versionRef.current = shownVersionNo;

  // Keyed on the document and the version, so the effect runs once per
  // showing and not again while the same version stays on screen.
  const shownKey =
    shownVersionNo === null || options.writesRefused === true
      ? null
      : `${scopeId}#${shownVersionNo}`;
  useEffect(() => {
    const versionNo = versionRef.current;
    if (shownKey === null || versionNo === null) return;
    versionApi.markSeen(scopeRef.current, versionNo).catch((error: unknown) => {
      refreshRemovedFromCodeSchema(queryClient, error);
    });
  }, [shownKey, queryClient]);
}
