"use client";

/**
 * Which tab of a document's editor is open, kept in the page's address.
 *
 * `?tab=<id>` while a plugin's tab is open, named by its contribution's id,
 * and nothing while the editor's own Content tab is, so an address without
 * it opens the form as it always has. An address names what is on screen, so
 * a reload, or a link shared with a colleague, opens the same tab; one naming
 * a tab this document does not have opens Content (`PlaceTabs`).
 *
 * Choosing a tab replaces the current history entry rather than adding one,
 * so Back leaves the document as it did before tabs, rather than stepping
 * through every tab looked at. The unsaved-changes guard takes the move as
 * staying on the page (`useUnsavedChanges`).
 *
 * @module components/features/entries/EntryForm/document-tab-address
 */
import { useCallback, useEffect, useState } from "react";

import { useSearchParams } from "@admin/hooks/useSearchParams";
import { setSearchParams } from "@admin/lib/navigation";
import { getSearchParam } from "@admin/lib/search-params";

/** The key that names the open tab. */
export const DOCUMENT_TAB_PARAM = "tab";

export interface DocumentTabAddress {
  /** The tab the address names, or `null` for the editor's own content. */
  openTab: string | null;
  /** Open a tab, or the content with `null`, and name it in the address. */
  openTabChange: (tab: string | null) => void;
}

/**
 * The open tab as the address names it.
 *
 * Held in local state as well, set the moment a tab is chosen and re-read
 * whenever the address changes (Back and Forward included): the address is
 * the source, and the screen answers a click without waiting for the router
 * to announce the move.
 */
export function useDocumentTabAddress(): DocumentTabAddress {
  // A repeated key takes its first value, as a browser resolves one.
  const named = getSearchParam(useSearchParams(), DOCUMENT_TAB_PARAM);
  const [openTab, setOpenTab] = useState(named);
  useEffect(() => setOpenTab(named), [named]);

  const openTabChange = useCallback((tab: string | null) => {
    setOpenTab(tab);
    setSearchParams({ [DOCUMENT_TAB_PARAM]: tab }, { replace: true });
  }, []);

  return { openTab, openTabChange };
}
