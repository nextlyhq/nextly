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
 * @module components/features/entries/PreviewMode/useMeasuredWidth
 */
import { useEffect, useState, type RefObject } from "react";

export function useMeasuredWidth(
  ref: RefObject<HTMLElement | null>
): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
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
