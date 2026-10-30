"use client";

/**
 * Whether the document panel is on screen, how it sits beside the editor, and
 * what showing or hiding it does to the other things that share the right
 * side.
 *
 * The right side holds one thing at a time. History takes the panel's place
 * while it is open, and the preview pane folds it while it is open: each needs
 * a column of its own, and two beside the fields leave the fields too narrow
 * to edit. Showing the panel closes the preview. The author's own choice is
 * kept underneath both, and back in force once they close.
 *
 * That choice is kept in `nextly:admin:entry-rail-collapsed`, shared by the
 * entry and Single editors, and it is the docked panel's alone. Where the
 * editor is too narrow to dock it (`document-panel-mode`), the panel opens
 * over the fields only when asked for and starts closed, so a laptop or a
 * phone never opens a document with its fields covered.
 *
 * One answer for every editor that has the panel, so the entry and Single
 * editors cannot come to disagree about when it shows.
 *
 * @module components/features/entries/EntryForm/useDocumentPanel
 */

import { useCallback, useState } from "react";

import { useHistoryAddress } from "@admin/components/features/versions/history-address";

import {
  useMeasuredPanelMode,
  type DocumentPanelMode,
} from "./document-panel-mode";
import { useRailCollapsed } from "./useRailCollapsed";

export interface DocumentPanelInput {
  /** Whether the document offers history at all; see `useHistoryAddress`. */
  historyAvailable?: boolean;
  /** Whether the preview pane is open beside the editor. */
  previewOpen?: boolean;
  /** Closes the preview pane, which showing the panel does. */
  closePreview?: () => void;
}

export interface DocumentPanelState {
  /** How the panel sits beside the editor at its present width. */
  mode: DocumentPanelMode;
  /** The ref that measures the editor's frame, which decides `mode`. */
  measure: (element: HTMLElement | null) => void;
  /** Whether the panel is on screen. */
  shown: boolean;
  /** Whether it is out of the way: the opposite of `shown`. */
  collapsed: boolean;
  /**
   * Whether it is on screen as the docked column, which carries the id and
   * the language panel, so the field column's own copies of them step aside.
   */
  docked: boolean;
  /** Shows the panel if it is not on screen, and hides it if it is. */
  toggle: () => void;
  /** Hides the panel: its close button, and Escape inside it. */
  hide: () => void;
}

export function useDocumentPanel({
  historyAvailable = true,
  previewOpen = false,
  closePreview,
}: DocumentPanelInput = {}): DocumentPanelState {
  const { collapsed: collapsedByAuthor, setCollapsed } = useRailCollapsed();
  const { open: historyOpen } = useHistoryAddress(historyAvailable);
  const [measure, mode] = useMeasuredPanelMode();
  // The panel over the fields, below the docking width. Closed until asked for.
  const [overlayOpen, setOverlayOpen] = useState(false);

  // The preview opening folds an open overlay for good, rather than masking
  // it: a panel springing back over the fields when the preview closes is not
  // something the author asked for. Read during render from the last value
  // seen, so whatever opened the preview, the fold follows.
  const [previewSeen, setPreviewSeen] = useState(previewOpen);
  if (previewOpen !== previewSeen) {
    setPreviewSeen(previewOpen);
    if (previewOpen) setOverlayOpen(false);
  }

  const wanted = mode === "docked" ? !collapsedByAuthor : overlayOpen;
  const shown = wanted && !historyOpen && !previewOpen;

  const show = useCallback(() => {
    if (previewOpen) {
      // The preview narrows the editor, so the mode read now is the preview's,
      // not the one the editor returns to once it closes: both answers are
      // set, and the width it comes back to decides which one shows.
      closePreview?.();
      setCollapsed(false);
      setOverlayOpen(true);
      return;
    }
    if (mode === "docked") setCollapsed(false);
    else setOverlayOpen(true);
  }, [previewOpen, closePreview, setCollapsed, mode]);

  const hide = useCallback(() => {
    if (mode === "docked") setCollapsed(true);
    setOverlayOpen(false);
  }, [mode, setCollapsed]);

  const toggle = useCallback(() => {
    if (shown) hide();
    else show();
  }, [shown, hide, show]);

  return {
    mode,
    measure,
    shown,
    collapsed: !shown,
    docked: shown && mode === "docked",
    toggle,
    hide,
  };
}
