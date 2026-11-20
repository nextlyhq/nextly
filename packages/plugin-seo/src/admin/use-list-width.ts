/**
 * How wide a list is drawn, read from the element around it, so a screen
 * can choose its columns by the room the list has rather than by the
 * window: the admin's menus take a different share of the window as they
 * open and close.
 *
 * Read before the first paint and again whenever the element resizes, so
 * the list is never drawn once with columns it then drops. `undefined`
 * until the element is mounted, and never updated where the browser has no
 * `ResizeObserver`.
 *
 * @module admin/use-list-width
 */
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** The element to measure, and its width in pixels once measured. */
export function useListWidth(): [
  RefObject<HTMLDivElement | null>,
  number | undefined,
] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
