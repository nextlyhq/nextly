"use client";

/**
 * Keep a scrolling tab strip honest about what it hides.
 *
 * A `scrollable` tab list scrolls sideways when its tabs are wider than the
 * screen, and nothing says so: on a phone the last tab is cut off mid-word and
 * reads as the end of the strip. Two things fix that, and this hook drives
 * both. It says which edges have tabs beyond them, so the strip can fade
 * there; and it scrolls the selected tab into view whenever the selection
 * changes, so a tab opened from a link is never the one out of sight.
 *
 * Reads the shared tab list's own scroll container (`tabs-list-scroller`)
 * rather than wrapping another, so the strip keeps the rail and indicator the
 * shared component draws.
 *
 * @module components/features/releases/useTabStripOverflow
 */
import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Which edges of the strip have tabs scrolled out of sight beyond them. */
export interface TabStripEdges {
  start: boolean;
  end: boolean;
}

/** Space kept beyond a tab scrolled into view, so its edge is not flush. */
const EDGE_ROOM_PX = 24;

/** A sub-pixel tolerance: fractional widths never quite reach the end. */
const SLACK_PX = 1;

function scrollerIn(root: HTMLElement | null): HTMLElement | null {
  return (
    root?.querySelector<HTMLElement>('[data-slot="tabs-list-scroller"]') ?? null
  );
}

/**
 * Scroll the strip just far enough that the selected tab is in view.
 *
 * Measured against the scroller rather than with `scrollIntoView`, which would
 * also scroll the page to bring the strip itself into view.
 */
function revealSelected(root: HTMLElement, scroller: HTMLElement): void {
  const tab = root.querySelector<HTMLElement>(
    '[role="tab"][data-state="active"]'
  );
  if (!tab) return;
  const box = scroller.getBoundingClientRect();
  const at = tab.getBoundingClientRect();
  if (at.left < box.left) {
    scroller.scrollLeft -= box.left - at.left + EDGE_ROOM_PX;
  } else if (at.right > box.right) {
    scroller.scrollLeft += at.right - box.right + EDGE_ROOM_PX;
  }
}

/**
 * The edges with hidden tabs, and a ref for the element holding the strip.
 *
 * @param selected - the selected tab's value; the strip scrolls it into view
 *   each time it changes.
 */
export function useTabStripOverflow(selected: string): {
  ref: RefObject<HTMLDivElement | null>;
  edges: TabStripEdges;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<TabStripEdges>({
    start: false,
    end: false,
  });

  useLayoutEffect(() => {
    const root = ref.current;
    const scroller = scrollerIn(root);
    if (!root || !scroller) return;
    const measure = () => {
      const { scrollLeft, clientWidth, scrollWidth } = scroller;
      const next = {
        start: scrollLeft > SLACK_PX,
        end: scrollLeft + clientWidth < scrollWidth - SLACK_PX,
      };
      setEdges(prev =>
        prev.start === next.start && prev.end === next.end ? prev : next
      );
    };
    // A count arriving widens a tab, and a rotated phone narrows the strip;
    // either can hide a tab without a scroll, the selected one included, so
    // a resize brings it back as well as re-measuring. A scroll does not:
    // the reader scrolling the strip is not to be scrolled back.
    const onResize = () => {
      revealSelected(root, scroller);
      measure();
    };
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(onResize);
    observer?.observe(scroller);
    const list = scroller.firstElementChild;
    if (list) observer?.observe(list);
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    const root = ref.current;
    const scroller = scrollerIn(root);
    if (root && scroller) revealSelected(root, scroller);
  }, [selected]);

  return { ref, edges };
}
