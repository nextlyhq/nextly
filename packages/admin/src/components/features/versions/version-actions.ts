/**
 * What a past version on screen offers, for every surface that draws it.
 *
 * The document bar and the phone's bottom bar both offer Back to current and
 * Restore this version; they read the one answer here, so neither offers
 * restoring on a different rule.
 *
 * @module components/features/versions/version-actions
 */

import {
  useDocumentHistory,
  type ViewedVersion,
} from "./document-history-context";

/**
 * Whether the chosen version is actually on screen.
 *
 * A read that has not returned leaves `isLoading` false with no error and no
 * snapshot: the query is disabled whenever the scope is not yet addressable,
 * and a paused one reports the same. Deciding from `isLoading` alone would
 * render an empty document as though it were the version, and offer to restore
 * what nobody has seen.
 */
export function versionOnScreen(viewing: ViewedVersion): boolean {
  return (
    viewing.error === null &&
    !viewing.isLoading &&
    viewing.snapshot !== undefined
  );
}

/** What can be done from a past version on screen. */
export interface VersionActions {
  /** Back to the live document, through the panel when one is mounted. */
  returnToCurrent: () => void;
  /** Opens the panel's restore confirmation; absent where it is not offered. */
  restore?: () => void;
  /**
   * Whether restoring waits: until the version is actually on screen,
   * restoring would be a decision made without seeing what is chosen.
   */
  restoreDisabled: boolean;
}

/**
 * The actions a past version offers, for every surface that draws them (the
 * title bar, and the bottom bar on a phone), so none of them offers restoring
 * on a different rule. Null while the live document is on screen.
 *
 * @param actionsDisabled - why every write is refused right now, whether by a
 *   colleague's claim or a submit in flight; a caller who may not write the
 *   live document is not offered a write into its past either
 */
export function useVersionActions(
  actionsDisabled: boolean
): VersionActions | null {
  const { viewing, setViewing, restore } = useDocumentHistory();
  if (!viewing) return null;
  return {
    // Routed through the panel when one is mounted, so its selection clears
    // with the shared state. The direct fallback works without a panel.
    returnToCurrent: restore?.returnToCurrent ?? (() => setViewing(null)),
    // Offered only when the panel says this caller may write.
    ...(restore?.canRestore && !actionsDisabled
      ? { restore: restore.request }
      : {}),
    restoreDisabled: !versionOnScreen(viewing),
  };
}
