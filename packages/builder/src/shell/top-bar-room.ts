/**
 * Whether the editor's top bar is crowded: whether its controls, with the
 * page title at its shortest, still need more room than the bar has.
 *
 * The bar gives way in one order as room runs out. The title shortens first
 * (its column lets it alone shrink, down to a floor), and only once it is at
 * that floor do the words marked `data-topbar-word` step aside, each leaving
 * its icon and its accessible name: Preview's word, and the page data
 * meter's "what's this?". Save, Publish and the active width never shorten.
 *
 * A fixed bar width cannot say when that is, since what the bar holds
 * changes with the page (a long title or a short one, Save or "✓ Saved",
 * the meter shown or not), so the bar is measured instead: each column's
 * controls at the width they draw at, the shortening title at its floor,
 * and each word that has stepped aside at the width it would take back.
 *
 * @module top-bar-room
 */
import * as React from "react";

import { isHTMLElement } from "../dom-kind";

/** Marks the control that shortens first: the page's title. */
const TOP_BAR_SHORTENS = "data-topbar-shortens";

/** Marks words that step aside once the title is at its shortest. */
const TOP_BAR_WORD = "data-topbar-word";

/** The bar's measurements that decide whether it is crowded. */
export interface TopBarRoom {
  /** The room the bar's columns share: its width less its padding. */
  readonly available: number;
  /** What the columns' own controls take, the title at its floor. */
  readonly controls: number;
  /** What the gaps between the columns take. */
  readonly gaps: number;
  /**
   * What the words that have stepped aside would take back, each with the
   * gap beside it: nothing while none has.
   */
  readonly words: number;
}

/**
 * Whether the bar is crowded: whether its controls, with every word drawn,
 * need more than the room it has. Half a pixel of slack, so a width that
 * rounds to the room is not read as short of it.
 */
export function topBarCrowded(room: TopBarRoom): boolean {
  return room.controls + room.gaps + room.words > room.available + 0.5;
}

/** Whether an element takes part in its row's layout. */
function laidOut(element: Element): element is HTMLElement {
  if (!isHTMLElement(element)) return false;
  const style = getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.position !== "absolute" &&
    style.position !== "fixed"
  );
}

/** A flex row's gap between items, in pixels. */
function gapOf(element: Element): number {
  return parseFloat(getComputedStyle(element).columnGap) || 0;
}

/**
 * What a column's controls take: each at its laid-out width, the shortening
 * title at its floor (its `min-width`), and the gaps between them. The bar
 * is in the editor's own document, never the canvas's frame, so its layout
 * widths (`offsetWidth`) are read directly; whole pixels, which the half
 * pixel of slack and the measuring of both states alike absorb.
 */
function columnNeeds(column: Element): number {
  const items = [...column.children].filter(laidOut);
  let total = gapOf(column) * Math.max(0, items.length - 1);
  for (const item of items) {
    total += item.hasAttribute(TOP_BAR_SHORTENS)
      ? parseFloat(getComputedStyle(item).minWidth) || 0
      : item.offsetWidth;
  }
  return total;
}

/**
 * What the words that have stepped aside would take back: a hidden word is
 * out of its row, so it frees its own width (its `scrollWidth`, which a
 * clipped word still reports) and the gap its row kept beside it.
 */
function hiddenWords(bar: Element): number {
  let total = 0;
  for (const word of bar.querySelectorAll(`[${TOP_BAR_WORD}]`)) {
    if (laidOut(word)) continue;
    total += word.scrollWidth;
    if (word.parentElement !== null) total += gapOf(word.parentElement);
  }
  return total;
}

/** The bar measured, as {@link topBarCrowded} reads it. */
export function measureTopBar(bar: Element): TopBarRoom {
  const style = getComputedStyle(bar);
  const columns = [...bar.children].filter(laidOut);
  return {
    available:
      bar.clientWidth -
      (parseFloat(style.paddingLeft) || 0) -
      (parseFloat(style.paddingRight) || 0),
    controls: columns.reduce((sum, column) => sum + columnNeeds(column), 0),
    gaps: gapOf(bar) * Math.max(0, columns.length - 1),
    words: hiddenWords(bar),
  };
}

/**
 * The top bar's own ref, handed on to `headerRef` as well, and whether the
 * bar it holds is crowded ({@link useTopBarCrowded}).
 */
export function useTopBarRoom(
  headerRef: (element: HTMLElement | null) => void
): {
  readonly ref: (element: HTMLElement | null) => void;
  readonly crowded: boolean;
} {
  const [bar, setBar] = React.useState<HTMLElement | null>(null);
  const crowded = useTopBarCrowded(bar);
  const ref = React.useCallback(
    (element: HTMLElement | null) => {
      headerRef(element);
      setBar(element);
    },
    [headerRef]
  );
  return { ref, crowded };
}

/**
 * Whether the bar `bar` holds is crowded, measured again whenever the bar
 * or anything in its columns changes size, and whenever a column's controls
 * come or go.
 *
 * Without `ResizeObserver` (jsdom) nothing is measured and the bar reads as
 * not crowded, so every word is drawn.
 */
function useTopBarCrowded(bar: HTMLElement | null): boolean {
  const [crowded, setCrowded] = React.useState(false);
  React.useLayoutEffect(() => {
    if (bar === null || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setCrowded(topBarCrowded(measureTopBar(bar)));
    };
    // Once a frame at most: a label changing sets off several observers.
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    const sizes = new ResizeObserver(schedule);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(bar);
      for (const column of bar.children) {
        for (const item of column.children) sizes.observe(item);
      }
      schedule();
    };
    // Controls come and go (the meter, a chip, Save's mark): the new ones
    // are watched too.
    const shape = new MutationObserver(watch);
    shape.observe(bar, { childList: true, subtree: true });
    watch();
    return () => {
      sizes.disconnect();
      shape.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [bar]);
  return crowded;
}
