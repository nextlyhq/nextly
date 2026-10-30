/**
 * The dashboard's own width, in pixels, or `undefined` before it has been measured.
 *
 * The one observer of the dashboard's width. A card's tier is predicted from it before the
 * card is drawn (with the card's span, through `predictedTier`), and the drag reads from it
 * whether the dashboard is one column (`isOneColumn`). It measures the element the
 * grid's `@container/dashboard` rules answer to, so the number and the drawn spans agree.
 *
 * @module components/features/widgets/useDashboardWidth
 */
import { useEffect, useLayoutEffect, type RefObject } from "react";

import { useMeasuredWidth } from "@admin/components/shared/preview/useMeasuredWidth";

/** The dashboard drawn now, whose width the layout read is sent; none off the dashboard. */
let drawnDashboard: RefObject<HTMLElement | null> | undefined;

/** A layout effect where there is a DOM, a passive one where there is not (`useMeasuredWidth`). */
const useDrawnEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The width of the dashboard at `ref`.
 *
 * `undefined` rather than a guess until the first measure: a tier predicted from a guessed
 * width would size a query for a card the dashboard then draws at another tier.
 *
 * Also names `ref` as the dashboard drawn now (`dashboardWidthNow`), from a layout effect, which
 * runs before the layout read a mounting dashboard makes is sent.
 */
export function useDashboardWidth(
  ref: RefObject<HTMLElement | null>
): number | undefined {
  useDrawnEffect(() => {
    drawnDashboard = ref;
    return () => {
      if (drawnDashboard === ref) drawnDashboard = undefined;
    };
  }, [ref]);
  return useMeasuredWidth(ref) ?? undefined;
}

/**
 * The drawn dashboard's width as it measures now, by the measure `useMeasuredWidth` takes, or
 * `undefined` off the dashboard or before it has a width (zero is none, as there). Read when the
 * layout is asked for, so the layout read judges each card that hides while empty at the tier
 * the card's first query will ask at (`predictedTier` of this same width).
 */
export function dashboardWidthNow(): number | undefined {
  const width = drawnDashboard?.current?.getBoundingClientRect().width;
  return width === undefined || width <= 0 ? undefined : width;
}
