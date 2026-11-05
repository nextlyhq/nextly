"use client";

import * as React from "react";

/** Room left under the panel, the same as the gap its sticky top keeps above. */
const GAP_BELOW_PX = 16;

/**
 * The least the panel is given, so a panel pushed low on the page still shows
 * its header and a little of what is under it rather than collapsing.
 */
const MIN_HEIGHT_PX = 240;

/**
 * Holds the panel beside the grid to the part of the window below where it
 * sits, so its header and its actions are both on screen and the details
 * between them scroll inside it.
 *
 * Measured rather than written as a fixed `calc()`: the panel sticks only
 * once the page has scrolled it up to its sticky top, and before then it sits
 * under the breadcrumbs and the toolbar, lower by however tall they are. A
 * height that assumes the sticky position runs the actions off the bottom of
 * the window on a page that hasn't scrolled, which is most pages with a few
 * items. Measured again on every render, on scroll anywhere on the page (the
 * page's main area scrolls, not the window, and a scroll there doesn't bubble,
 * hence the capture), and on resize.
 */
export function useMediaDetailsPanelHeight(
  ref: React.RefObject<HTMLElement | null>
): void {
  const fit = React.useCallback(() => {
    const panel = ref.current;
    if (!panel) return;
    const top = Math.max(panel.getBoundingClientRect().top, 0);
    const room = window.innerHeight - top - GAP_BELOW_PX;
    panel.style.maxHeight = `${Math.max(room, MIN_HEIGHT_PX)}px`;
  }, [ref]);

  // Anything above the panel changing height (the upload area opening, a
  // folder row appearing) re-renders the library and so this panel.
  React.useLayoutEffect(fit);

  React.useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        fit();
      });
    };
    window.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [fit]);
}
