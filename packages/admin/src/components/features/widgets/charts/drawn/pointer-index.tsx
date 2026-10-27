/**
 * Which mark the pointer is over, read through the chart engine's own scale, and what a drawing
 * shares besides.
 *
 * The engine never sees the pointer, and draws no tooltip: a tooltip state of its own would follow
 * the pointer, away from a reader reaching for it, and once it had seen the pointer it would keep
 * that point whatever the keys said. The keys and the pointer together decide the point in view
 * (`useChartReach`), and a drawing asks the engine's inverse scale which category a pixel is
 * nearest, mapping that category to its index.
 *
 * Across, a point over time is at its data's position, so the nearest data point is the one in
 * view. Down, a group's row is a band, and the engine's data snap measures from each band's START:
 * the lower half of a row would read as the next group. Its tick snap measures from the rendered
 * ticks, which a category axis draws at each band's middle, so it names the row the pointer is in. The marks, the rule and this reading are on one
 * scale, the engine's.
 *
 * @module components/features/widgets/charts/drawn/pointer-index
 */

import {
  useEffect,
  useMemo,
  useRef,
  type MouseEvent,
  type MutableRefObject,
} from "react";
import {
  useXAxisInverseDataSnapScale,
  useYAxisInverseTickSnapScale,
} from "recharts";

/** The index of the mark at a point in the drawing, or `undefined` off every mark. */
type IndexAt = (x: number, y: number) => number | undefined;

/**
 * Inside a chart: keeps `into` answering which category, of `keys` in drawn order, a point in the
 * drawing is nearest along `axis`.
 */
export function PointerIndex({
  axis,
  axisId,
  keys,
  into,
}: {
  axis: "x" | "y";
  axisId?: string;
  keys: readonly string[];
  into: MutableRefObject<IndexAt | undefined>;
}): null {
  const across = useXAxisInverseDataSnapScale(axisId);
  // Every row's tick must be drawn for this to name every row (`interval={0}`).
  const down = useYAxisInverseTickSnapScale(axisId);
  const invert = axis === "x" ? across : down;
  useEffect(() => {
    into.current = invert
      ? (x, y) => {
          const index = keys.indexOf(String(invert(axis === "x" ? x : y)));
          return index >= 0 ? index : undefined;
        }
      : undefined;
  });
  return null;
}

/**
 * The reading `PointerIndex` keeps, and a handler for the drawing's pointer moves that reports
 * each move's mark through `onHover`.
 */
export function usePointerIndex(onHover: (index: number) => void): {
  into: MutableRefObject<IndexAt | undefined>;
  onMouseMove: (event: MouseEvent<HTMLElement>) => void;
} {
  const into = useRef<IndexAt | undefined>(undefined);
  return {
    into,
    onMouseMove: event => {
      // A move onto the tooltip is the reader reaching it, not a move to the mark beneath it,
      // so the tooltip stays on its mark while it is read (WCAG 2.2 1.4.13).
      if (
        event.target instanceof Element &&
        event.target.closest("[data-chart-tooltip]")
      ) {
        return;
      }
      const box = event.currentTarget.getBoundingClientRect();
      const index = into.current?.(
        event.clientX - box.left,
        event.clientY - box.top
      );
      if (index !== undefined) onHover(index);
    },
  };
}

/**
 * Marks a chart's tooltip, which the pointer may move onto to read it: a move there is the reader
 * reaching the tooltip, not a move to the mark beneath it (WCAG 2.2 1.4.13).
 */
export const TOOLTIP_MARK = { "data-chart-tooltip": "" } as const;

/**
 * `value` itself while it holds what it held before, compared by content. The engine animates its
 * marks in again whenever it is handed a new data array, and a chart rebuilds its data on every
 * render, so without this a hover would start the marks growing from nothing.
 */
export function useStableValue<T>(value: T): T {
  const signature = JSON.stringify(value);
  return useMemo(() => JSON.parse(signature) as T, [signature]);
}
