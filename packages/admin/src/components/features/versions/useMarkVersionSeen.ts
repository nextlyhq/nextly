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
 * not reported over the editor.
 *
 * @module components/features/versions/useMarkVersionSeen
 */

import { useEffect, useRef } from "react";

import { versionApi, type VersionScope } from "@admin/services/versionApi";

/**
 * @param scope - the document whose history is being read
 * @param scopeId - a stable string naming that document, so a scope object
 *   rebuilt each render is not read as a different document
 * @param shownVersionNo - the version on screen, or null while none is
 */
export function useMarkVersionSeen(
  scope: VersionScope,
  scopeId: string,
  shownVersionNo: number | null
): void {
  // Read through refs: `shownKey` alone says when a showing starts, and a
  // scope object rebuilt for the same document is not a new one.
  const scopeRef = useRef(scope);
  const versionRef = useRef(shownVersionNo);
  scopeRef.current = scope;
  versionRef.current = shownVersionNo;

  // Keyed on the document and the version, so the effect runs once per
  // showing and not again while the same version stays on screen.
  const shownKey =
    shownVersionNo === null ? null : `${scopeId}#${shownVersionNo}`;
  useEffect(() => {
    const versionNo = versionRef.current;
    if (shownKey === null || versionNo === null) return;
    versionApi.markSeen(scopeRef.current, versionNo).catch(() => undefined);
  }, [shownKey]);
}
