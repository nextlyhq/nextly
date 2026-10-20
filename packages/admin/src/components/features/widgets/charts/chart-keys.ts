/**
 * How the arrow keys move through a focused chart.
 *
 * A chart is one tab stop; inside it the keys move the current point, which a
 * polite live region then reads. Over time: Left and Right along the series,
 * Up and Down between series where there are several (and along the series
 * where there is one, so the vertical arrows are not silent), Home and End to
 * its ends. A chart of groups: every arrow steps bar by bar, top to bottom.
 * Nothing wraps, so holding a key never jumps back to the start unannounced.
 *
 * @module components/features/widgets/charts/chart-keys
 */

/** A chart's points: how many series and points, or how many bars. */
export type ChartShape =
  | { kind: "points"; series: number; points: number }
  | { kind: "bars"; bars: number };

/** The current point: its series and its index within it. */
export interface ChartPosition {
  series: number;
  index: number;
}

const clamp = (value: number, last: number) =>
  Math.max(0, Math.min(last, value));

/**
 * Where reading starts when the chart takes focus: the latest point of the
 * first series over time, the first (highest) bar of a chart of groups.
 * `undefined` for a chart with nothing in it.
 */
export function firstPosition(shape: ChartShape): ChartPosition | undefined {
  if (shape.kind === "bars") {
    return shape.bars > 0 ? { series: 0, index: 0 } : undefined;
  }
  return shape.points > 0 && shape.series > 0
    ? { series: 0, index: shape.points - 1 }
    : undefined;
}

/** The step a key takes along a run of `length` from `index`, or `undefined`. */
function along(
  index: number,
  key: string,
  length: number,
  back: string[],
  on: string[]
) {
  const last = length - 1;
  if (key === "Home") return 0;
  if (key === "End") return last;
  if (back.includes(key)) return clamp(index - 1, last);
  if (on.includes(key)) return clamp(index + 1, last);
  return undefined;
}

/**
 * Where `key` moves the current point, or `undefined` when it is not a move
 * (the page, or the tooltip for Escape, handles it).
 */
export function moveInChart(
  at: ChartPosition,
  key: string,
  shape: ChartShape
): ChartPosition | undefined {
  if (shape.kind === "bars") {
    if (shape.bars === 0) return undefined;
    const index = along(
      at.index,
      key,
      shape.bars,
      ["ArrowUp", "ArrowLeft"],
      ["ArrowDown", "ArrowRight"]
    );
    return index === undefined ? undefined : { series: 0, index };
  }
  if (shape.points === 0 || shape.series === 0) return undefined;
  if (shape.series > 1 && (key === "ArrowUp" || key === "ArrowDown")) {
    const series = clamp(
      at.series + (key === "ArrowUp" ? -1 : 1),
      shape.series - 1
    );
    return { series, index: at.index };
  }
  const index = along(
    at.index,
    key,
    shape.points,
    ["ArrowLeft", "ArrowDown"],
    ["ArrowRight", "ArrowUp"]
  );
  return index === undefined ? undefined : { series: at.series, index };
}
