"use client";

/**
 * How the document panel sits beside the editor, decided by the editor's own
 * width.
 *
 * - `docked`: 1000px and wider. The panel is a column beside the fields, and
 *   the author's choice to show or fold it is kept between visits.
 * - `floating`: under 1000px. The fields keep the whole width, and the panel
 *   opens over their right edge when asked for, with its own close button.
 * - `sheet`: under 600px, a phone. The panel opens as a sheet from the bottom
 *   of the screen, and the bar's History, preview and panel toggle fold into
 *   the document's menu as rows.
 *
 * The width is the editor's frame, measured in the browser, rather than the
 * window or a container query. The window is the wrong width: the admin's
 * sidebar and an open preview both take from it. And the menu that holds the
 * folded rows opens in a layer outside the editor, where no container query
 * against the editor can reach; one measured answer is read by the bar, its
 * menu and the panel alike, so none of them can disagree about the mode.
 *
 * @module components/features/entries/EntryForm/document-panel-mode
 */

import { useCallback, useLayoutEffect, useState } from "react";

export type DocumentPanelMode = "docked" | "floating" | "sheet";

/** Below this editor width the panel floats over the fields. */
const PANEL_FLOATS_BELOW = 1000;

/** Below this editor width the panel is a bottom sheet. */
const PANEL_SHEET_BELOW = 600;

/**
 * The mode for an editor this wide. A width of zero is an editor not laid out
 * (a test's DOM, or one not yet in the page), which is read as the desktop
 * layout rather than as the narrowest screen there is.
 */
function panelModeForWidth(width: number): DocumentPanelMode {
  if (width <= 0) return "docked";
  if (width < PANEL_SHEET_BELOW) return "sheet";
  if (width < PANEL_FLOATS_BELOW) return "floating";
  return "docked";
}

/**
 * Measures the element given as its ref and answers the panel mode for its
 * width, again whenever the width crosses a threshold.
 *
 * Measured in a layout effect, so the first paint is already in the right
 * mode: a phone never shows the desktop column for a frame first.
 */
export function useMeasuredPanelMode(): [
  measure: (element: HTMLElement | null) => void,
  mode: DocumentPanelMode,
] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<DocumentPanelMode>("docked");

  useLayoutEffect(() => {
    if (!element) return;
    setMode(panelModeForWidth(element.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      const entry = entries.at(-1);
      if (!entry) return;
      // Setting the same mode again renders nothing, so a resize within one
      // band costs no render.
      setMode(panelModeForWidth(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const measure = useCallback((next: HTMLElement | null) => {
    setElement(next);
  }, []);

  return [measure, mode];
}
