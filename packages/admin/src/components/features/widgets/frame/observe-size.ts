/**
 * Calls `measure` now and again whenever `element` changes size, where the browser can say so,
 * and answers how to stop: what an effect returns. The one way the dashboard's cards watch their
 * own height, as a card is as tall as its content and its content changes size after it is drawn.
 *
 * @module components/features/widgets/frame/observe-size
 */
export function observeSize(
  element: Element,
  measure: () => void
): (() => void) | undefined {
  measure();
  if (typeof ResizeObserver === "undefined") return undefined;
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  return () => observer.disconnect();
}
