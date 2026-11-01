"use client";

/**
 * The setup card's row of steps, and what it says when it scrolls.
 *
 * The row is one tile high at every width and scrolls sideways where the card is narrower than its
 * tiles (`SETUP_ROW`). It has no height to spare for a scrollbar, so while it overflows it says so
 * in the scrollbar's place, for each way of reaching what is out of view:
 * - the eye: a fade over the edge on each side that has more, so a cut tile reads as more to come;
 * - a pointer: a scroll button inside each fade, a tile at a time;
 * - the keyboard: the row is a stop of its own, named as scrolling ("Setup steps, scrolls
 *   sideways"), drawn with the focus ring, and the arrow keys scroll it a tile at a time. A step
 *   with nothing to press, a done one, is reached this way as well.
 *
 * None of it while the tiles fit: the row is then no stop, and no fade or button is drawn. The
 * fades and buttons are laid over the row, never beside it, so whether they are drawn moves
 * nothing.
 *
 * @module components/features/dashboard/setup/StepRow
 */

import type { JSX, ReactNode, RefObject } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { ChevronLeft, ChevronRight } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { SETUP_GAP, SETUP_ROW } from "./measures";

/** Whether the row overflows, and on which side it has more out of view. */
interface RowOverflow {
  overflows: boolean;
  before: boolean;
  after: boolean;
}

const FITS: RowOverflow = { overflows: false, before: false, after: false };

/** The row's overflow as it is drawn now: a pixel's slack, for rounding. */
function overflowOf(row: HTMLElement): RowOverflow {
  const room = row.scrollWidth - row.clientWidth;
  if (room <= 1) return FITS;
  return {
    overflows: true,
    before: row.scrollLeft > 1,
    after: row.scrollLeft < room - 1,
  };
}

/**
 * The row's overflow, read after every draw (a step added or answered changes the tiles' widths),
 * as it is scrolled, and as it or a tile is resized.
 */
function useRowOverflow(row: RefObject<HTMLElement | null>): RowOverflow {
  const [overflow, setOverflow] = useState<RowOverflow>(FITS);
  const update = useCallback(() => {
    const element = row.current;
    if (element === null) return;
    const next = overflowOf(element);
    setOverflow(previous =>
      previous.overflows === next.overflows &&
      previous.before === next.before &&
      previous.after === next.after
        ? previous
        : next
    );
  }, [row]);
  useLayoutEffect(update);
  useEffect(() => {
    const element = row.current;
    if (element === null) return;
    element.addEventListener("scroll", update, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    observer?.observe(element);
    for (const tile of Array.from(element.children)) observer?.observe(tile);
    return () => {
      element.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [row, update]);
  return overflow;
}

/** How far one press scrolls: the first tile's width and the gap after it, a tile at a time. */
function stepOf(row: HTMLElement): number {
  const tile = row.firstElementChild;
  const width = tile === null ? 0 : tile.getBoundingClientRect().width;
  return width > 0 ? width + SETUP_GAP.px : Math.max(row.clientWidth / 2, 1);
}

/** A fade over one edge of the row, with the button that scrolls toward it. */
function EdgeCue({
  side,
  label,
  onScroll,
}: {
  side: "before" | "after";
  label: string;
  onScroll: () => void;
}) {
  const Icon = side === "before" ? ChevronLeft : ChevronRight;
  return (
    <span
      data-setup-row-cue={side}
      className={cn(
        "pointer-events-none absolute inset-y-0 flex w-10 items-center from-card to-transparent",
        side === "before"
          ? "left-0 justify-start bg-gradient-to-r"
          : "right-0 justify-end bg-gradient-to-l"
      )}
    >
      {/* Out of the tab order: the row itself is the keyboard's stop, and its arrow keys scroll. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={label}
        onClick={onScroll}
        className="pointer-events-auto flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground"
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * The row of `children` tiles, named `label`; while it overflows, named as scrolling, a keyboard
 * stop that the arrow keys scroll, with a fade and a scroll button on each side that has more.
 */
export function StepRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  const row = useRef<HTMLOListElement>(null);
  const { overflows, before, after } = useRowOverflow(row);
  const scroll = (direction: -1 | 1) => {
    const element = row.current;
    if (element === null) return;
    // The row's own scroll-behavior decides smooth or not, so a reduced-motion setting holds.
    element.scrollBy({ left: direction * stepOf(element) });
  };
  return (
    <div className="relative min-w-0">
      <ol
        ref={row}
        className={cn("min-w-0", SETUP_ROW.className, SETUP_GAP.className)}
        aria-label={overflows ? `${label}, scrolls sideways` : label}
        tabIndex={overflows ? 0 : undefined}
        onKeyDown={event => {
          // The row's own keys only: a tile's link or button keeps its keys.
          if (!overflows || event.target !== event.currentTarget) return;
          if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
            event.preventDefault();
            scroll(event.key === "ArrowRight" ? 1 : -1);
          }
        }}
      >
        {children}
      </ol>
      {before && (
        <EdgeCue
          side="before"
          label={`Scroll ${label.toLowerCase()} back`}
          onScroll={() => scroll(-1)}
        />
      )}
      {after && (
        <EdgeCue
          side="after"
          label={`Scroll ${label.toLowerCase()} on`}
          onScroll={() => scroll(1)}
        />
      )}
    </div>
  );
}
