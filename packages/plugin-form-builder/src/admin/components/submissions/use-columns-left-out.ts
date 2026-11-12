"use client";

/**
 * How many of a list's optional columns to leave out so its table fits.
 *
 * The admin's table never shrinks below its content: when the columns are
 * wider than the box, it scrolls sideways inside it, and on a narrow window or
 * beside an open side panel the list's last columns (its status and date) end
 * up out of sight. So after each render this measures the table against its
 * box and, while it overflows, leaves out one more optional column, before the
 * browser paints. When the box grows, every column is tried again.
 *
 * Measured rather than set by window width, because what fits depends on the
 * names, the form and the font as much as on the window.
 *
 * @module admin/components/submissions/use-columns-left-out
 */

import { type RefObject, useEffect, useLayoutEffect, useState } from "react";

/** Whether the table inside `box` is drawn and wider than its scroll box. */
function overflows(box: HTMLElement | null): boolean {
  const scroller = box?.querySelector("table")?.parentElement;
  // A table hidden in favour of the cards measures 0: nothing to fit.
  if (!scroller || scroller.clientWidth === 0) return false;
  return scroller.scrollWidth > scroller.clientWidth;
}

/**
 * The number of optional columns to leave out, at most `optional`. `columnSet`
 * names the columns on offer: a different set starts again from all of them.
 * `content` is what the table draws (its rows): new rows are measured again,
 * since they can widen a column as much as a narrower box can.
 */
export function useColumnsLeftOut(
  box: RefObject<HTMLElement | null>,
  optional: number,
  columnSet: string,
  content: unknown
): number {
  // `width` is the box's, as last observed: a change of it is measured again.
  const [fit, setFit] = useState({ columnSet, leftOut: 0, width: 0 });
  // A new column set is measured afresh: derived during render rather than in
  // an effect, so the first paint of the new set is not the old one's count.
  if (fit.columnSet !== columnSet) setFit({ ...fit, columnSet, leftOut: 0 });
  const leftOut = fit.columnSet === columnSet ? fit.leftOut : 0;

  // Once the columns, the rows or the box's width change, and again after
  // each column left out: one more out while the table overflows. Each step
  // renders again before paint, so the overflowing table never shows. It
  // ends, since `leftOut` only grows here and stops at `optional`.
  useLayoutEffect(() => {
    if (leftOut < optional && overflows(box.current)) {
      setFit(current => ({ ...current, leftOut: current.leftOut + 1 }));
    }
  }, [box, leftOut, optional, columnSet, content, fit.width]);

  // Any change of the box's width is measured again. A narrower box (the
  // window narrowed, a side panel opened) may no longer fit what is shown; a
  // wider one may fit what was left out, so every column is tried again and
  // the measurement above leaves out what still does not fit.
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      const next = element.clientWidth;
      if (next === width) return;
      const grew = next > width;
      width = next;
      setFit(current => ({
        ...current,
        width: next,
        leftOut: grew ? 0 : current.leftOut,
      }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [box]);

  return Math.min(leftOut, optional);
}
