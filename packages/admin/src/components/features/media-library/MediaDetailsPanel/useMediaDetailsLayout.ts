"use client";

import * as React from "react";

import {
  MEDIA_DETAILS_BESIDE_MIN_WIDTH,
  type MediaDetailsPanelLayout,
} from "./index";

/**
 * Whether the details panel fits beside the grid, from the LIBRARY's width
 * rather than the window's: the folder tree and the admin's sidebars take
 * width from the library without the window changing.
 *
 * The element measured holds the grid and the panel both, so the panel
 * opening never changes the answer it was placed by. A width of zero is an
 * element not laid out yet (or a test without layout), and reads as room
 * beside, the layout that traps nothing.
 */
export function useMediaDetailsLayout(
  ref: React.RefObject<HTMLElement | null>
): MediaDetailsPanelLayout {
  const [layout, setLayout] = React.useState<MediaDetailsPanelLayout>("beside");

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      setLayout(
        width === 0 || width >= MEDIA_DETAILS_BESIDE_MIN_WIDTH
          ? "beside"
          : "over"
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return layout;
}
