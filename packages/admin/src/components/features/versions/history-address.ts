/**
 * Where a document's history panel stands, kept in the page's address.
 *
 * `?history=1` while the panel is open, and `&version=N` while a version is
 * chosen in it. An address names what is on screen, so a reload or a link
 * shared with a colleague opens the same version, and the back button closes
 * the panel rather than leaving the document.
 *
 * Opening adds a history entry, so back closes it. Choosing a version replaces
 * the current entry rather than adding one per row looked at. Closing steps
 * back off the entry opening added, so back never reopens the panel; a panel
 * opened by a link, or one the author has since moved on from (another
 * language, say), is closed in place.
 *
 * @module components/features/versions/history-address
 */

import { useCallback, useEffect, useState } from "react";

import { useSearchParams } from "@admin/hooks/useSearchParams";
import { setSearchParams } from "@admin/lib/navigation";

/** The key that says the history panel is open. */
export const HISTORY_PARAM = "history";
/** The key that names the version chosen in it. */
export const VERSION_PARAM = "version";
/**
 * Set by the comparison page's "Restore…": opens the restore list for the
 * version the address names, once, in the editor that takes the values.
 */
export const RESTORE_PARAM = "restore";

/**
 * Every key the panel keeps, so a check that tells a move within the document
 * from leaving it names the same keys this module writes.
 */
export const HISTORY_ADDRESS_PARAMS: readonly string[] = [
  HISTORY_PARAM,
  VERSION_PARAM,
  RESTORE_PARAM,
];

/** Whether the address names history open right now. */
function readOpenFromAddress(): boolean {
  return new URLSearchParams(window.location.search).get(HISTORY_PARAM) === "1";
}

/**
 * The entry an open added, told apart from any other: the address as opening
 * left it, with the chosen version set aside, since choosing one replaces the
 * entry rather than leaving it.
 */
function openerEntry(search: string): string {
  const params = new URLSearchParams(search);
  params.set(HISTORY_PARAM, "1");
  params.delete(VERSION_PARAM);
  params.sort();
  return params.toString();
}

/**
 * The entry an open added, which closing can step back off while it is still
 * the one showing. One for the page, not one per reader of the address: the
 * side panel's History may open the panel and the document bar's sheet close
 * it, and a close that did not know of the open would leave a closed copy of
 * it for Back to land on. Forgotten once the address is closed by any means.
 */
const added: { entry: string | null } = { entry: null };

/** A version number from the address, or null for anything else. */
function readVersion(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string") return null;
  const versionNo = Number(raw);
  return Number.isInteger(versionNo) && versionNo > 0 ? versionNo : null;
}

export interface HistoryAddress {
  open: boolean;
  /** The version chosen, or null while the list is showing. */
  version: number | null;
  setOpen: (open: boolean) => void;
  setVersion: (version: number | null) => void;
}

/**
 * The panel's state as the address holds it, or closed wherever history is
 * not `available`: a link naming history on a document without it opens
 * nothing.
 *
 * Held in local state as well, set the moment this writes and re-read
 * whenever the address changes (back and forward included): the address is
 * the source, and the screen answers a click without waiting for the router
 * to announce the move.
 */
export function useHistoryAddress(available = true): HistoryAddress {
  const params = useSearchParams();
  const addressOpen = params[HISTORY_PARAM] === "1";
  const addressVersion = addressOpen
    ? readVersion(params[VERSION_PARAM])
    : null;

  const [open, setOpenState] = useState(addressOpen);
  const [version, setVersionState] = useState(addressVersion);
  useEffect(() => {
    setOpenState(addressOpen);
    if (!addressOpen) added.entry = null;
  }, [addressOpen]);
  useEffect(() => setVersionState(addressVersion), [addressVersion]);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (next) {
      // Only an open that adds the entry may later step back off it: one
      // already open, by a link, adds none, and stepping back would leave the
      // editor.
      if (!readOpenFromAddress()) {
        added.entry = openerEntry(window.location.search);
        setSearchParams({ [HISTORY_PARAM]: "1" });
      }
      return;
    }
    setVersionState(null);
    const opened = added.entry;
    added.entry = null;
    // Stepping back from any other entry would undo that move, not close.
    if (opened !== null && opened === openerEntry(window.location.search)) {
      window.history.back();
      return;
    }
    // A restore the comparison page asked for goes with it: the ask is for
    // the version the address named, once, and left behind it would open a
    // restore list unasked the next time history opens on a version.
    setSearchParams(
      { [HISTORY_PARAM]: null, [VERSION_PARAM]: null, [RESTORE_PARAM]: null },
      { replace: true }
    );
  }, []);

  // Choosing another version, or going back to the list, abandons a restore
  // asked for the version the address named, for the same reason.
  const setVersion = useCallback((next: number | null) => {
    setVersionState(next);
    setSearchParams(
      {
        [VERSION_PARAM]: next === null ? null : String(next),
        [RESTORE_PARAM]: null,
      },
      { replace: true }
    );
  }, []);

  return {
    open: available && open,
    version: available ? version : null,
    setOpen,
    setVersion,
  };
}
