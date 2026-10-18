/**
 * Whether the document panel beside the editor is out of the way.
 *
 * It is when the author collapsed it, and while history is open, which takes
 * its place. The author's choice is kept underneath, and back in force once
 * history closes. One answer for every editor that has the panel, so the entry
 * and Single editors cannot come to disagree about when it shows.
 *
 * @module components/features/entries/EntryForm/useDocumentPanelCollapsed
 */

import { useHistoryAddress } from "@admin/components/features/versions/history-address";

import { useRailCollapsed } from "./useRailCollapsed";

export function useDocumentPanelCollapsed(): {
  collapsed: boolean;
  /** Changes the author's choice, which applies once history is closed. */
  toggle: () => void;
} {
  const { collapsed, toggle } = useRailCollapsed();
  const { open: historyOpen } = useHistoryAddress();
  return { collapsed: collapsed || historyOpen, toggle };
}
