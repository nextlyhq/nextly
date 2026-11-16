"use client";

/**
 * The document bar's real height, published for what sticks below it.
 *
 * The bar is one row usually and two when a feature's wide control, or an
 * editor too narrow for every action, wraps it. The document panel sticks
 * under the bar and is as tall as the scroll area less the bar, so a fixed
 * one-row height would let a wrapped bar's second row cover the panel's top
 * once the editor scrolls. The bar measures itself instead and sets
 * `--document-bar-height` on the editor's frame, which every sticky part of
 * the editor inherits; `DOCUMENT_PANEL_STICKY` reads it, with the one-row
 * height as the fallback before the first measurement.
 *
 * A layout knob rather than a palette token, so it sits outside the theme's
 * `--nx-*` namespace, as `--editor-scrollport` does.
 *
 * @module components/features/entries/EntryForm/document-bar-height
 */

import { useEffect, useState } from "react";

/** The property the bar's height is published as. */
const DOCUMENT_BAR_HEIGHT_PROPERTY = "--document-bar-height";

/**
 * Marks the editor's frame: the element the height is published on, which
 * holds the bar, its banners and the row of field column and panel.
 */
export const DOCUMENT_EDITOR_FRAME_ATTRIBUTE = "data-document-editor-frame";

/**
 * Measures the element it is given as a ref and publishes its border-box
 * height on the enclosing editor frame for as long as both are mounted.
 * Outside a frame (a bar rendered on its own) it publishes nothing.
 *
 * A callback ref rather than an object one, so a bar that mounts after its
 * form does is measured from the moment it appears.
 */
export function useDocumentBarHeight(): (element: HTMLElement | null) => void {
  const [element, setElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const frame = element.closest<HTMLElement>(
      `[${DOCUMENT_EDITOR_FRAME_ATTRIBUTE}]`
    );
    if (!frame) return;
    const observer = new ResizeObserver(entries => {
      const entry = entries.at(-1);
      if (!entry) return;
      // The border box, as the bar's rule under it is part of what the panel
      // must clear. Where a browser reports no box sizes, the element's own.
      const height =
        entry.borderBoxSize[0]?.blockSize ??
        element.getBoundingClientRect().height;
      frame.style.setProperty(DOCUMENT_BAR_HEIGHT_PROPERTY, `${height}px`);
    });
    observer.observe(element, { box: "border-box" });
    return () => {
      observer.disconnect();
      frame.style.removeProperty(DOCUMENT_BAR_HEIGHT_PROPERTY);
    };
  }, [element]);

  return setElement;
}
