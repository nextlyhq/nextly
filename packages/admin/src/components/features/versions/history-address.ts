/**
 * Where a document's history panel stands, kept in the page's address.
 *
 * `?history=1` while the panel is open, and `&version=N` while a version is
 * chosen in it. An address names what is on screen, so a reload or a link
 * shared with a colleague opens the same version, and the back button closes
 * the panel rather than leaving the document.
 *
 * Opening adds a history entry, so back closes it. Choosing a version replaces
 * the current entry rather than adding one per row looked at. Closing clears
 * both keys in one step.
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
 * Every key the panel keeps, so a check that tells a move within the document
 * from leaving it names the same keys this module writes.
 */
export const HISTORY_ADDRESS_PARAMS: readonly string[] = [
  HISTORY_PARAM,
  VERSION_PARAM,
];

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
 * The panel's state as the address holds it.
 *
 * Held in local state as well, set the moment this writes and re-read
 * whenever the address changes (back and forward included): the address is
 * the source, and the screen answers a click without waiting for the router
 * to announce the move.
 */
export function useHistoryAddress(): HistoryAddress {
  const params = useSearchParams();
  const addressOpen = params[HISTORY_PARAM] === "1";
  const addressVersion = addressOpen
    ? readVersion(params[VERSION_PARAM])
    : null;

  const [open, setOpenState] = useState(addressOpen);
  const [version, setVersionState] = useState(addressVersion);
  useEffect(() => setOpenState(addressOpen), [addressOpen]);
  useEffect(() => setVersionState(addressVersion), [addressVersion]);

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    if (next) {
      setSearchParams({ [HISTORY_PARAM]: "1" });
      return;
    }
    setVersionState(null);
    setSearchParams({ [HISTORY_PARAM]: null, [VERSION_PARAM]: null });
  }, []);

  const setVersion = useCallback((next: number | null) => {
    setVersionState(next);
    setSearchParams(
      { [VERSION_PARAM]: next === null ? null : String(next) },
      { replace: true }
    );
  }, []);

  return { open, version, setOpen, setVersion };
}
