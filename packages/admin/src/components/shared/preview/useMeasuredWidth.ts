/**
 * The measured width of an element, or `null` until it has one.
 *
 * `null` is the point of this hook rather than a detail of it. Every caller here
 * has to distinguish "this box is N wide" from "nobody has looked yet", because
 * the second is not a width and anything derived from it is a guess — a preview
 * frame that names a viewport before layout announces a number, then corrects
 * itself, which reads as a glitch rather than as the honest "not yet" it is.
 *
 * Zero is folded into `null` deliberately. A detached or display-none element
 * measures zero, and a caller dividing by it produces `Infinity`; a caller
 * reading it as a real width concludes nothing fits. Neither is what "the box
 * has no size right now" should mean downstream.
 *
 * @module components/shared/preview/useMeasuredWidth
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/**
 * A layout effect where there is a DOM, a passive one where there is not.
 *
 * The same alias `ChromeSuppression` keeps, for the same reason: a layout
 * effect during a server render warns and cannot run, and nothing has painted
 * there for it to be ahead of.
 */
const useMeasureEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useMeasuredWidth(
  ref: RefObject<HTMLElement | null>
): number | null {
  const [width, setWidth] = useState<number | null>(null);

  /*
   * BEFORE paint, not after.
   *
   * The first measurement decides whether the frame is drawn at the requested
   * width or left to fill the pane, and an effect that runs after paint means
   * the browser has already drawn the second. Reopening a pane that remembers a
   * custom width therefore laid the site out responsively for one frame and
   * then jumped — visible as a flash of the wrong layout on any page that
   * crosses a breakpoint between the two widths.
   *
   * A layout effect runs after the DOM is in place and before the browser
   * paints, which is exactly when a box first has a width to report. The
   * alternative — hiding the frame until it has been measured — trades a wrong
   * layout for a blank one, and still costs a frame.
   */
  useMeasureEffect(() => {
    const element = ref.current;
    if (element === null) return;

    /*
     * `ResizeObserver` rather than a `resize` listener on the window: this box
     * changes width when the SPLIT moves, which the window never hears about.
     * A window listener would leave the frame sized for the old split until
     * something else happened to re-render it.
     */
    const observe = () => {
      const next = element.getBoundingClientRect().width;
      // Folded to `null` so a collapsed box cannot be read as a width. See the
      // module note: zero is not a small number here, it is an absent one.
      setWidth(next > 0 ? next : null);
    };

    observe();
    const observer = new ResizeObserver(observe);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return width;
}
