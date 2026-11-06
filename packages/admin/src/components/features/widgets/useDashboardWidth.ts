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
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  type Provider,
  type RefObject,
} from "react";

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
 * width would ask for a card at one tier while the dashboard then draws it at another.
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
 * the card's first ask will carry (`predictedTier` of this same width).
 */
export function dashboardWidthNow(): number | undefined {
  const width = drawnDashboard?.current?.getBoundingClientRect().width;
  return width === undefined || width <= 0 ? undefined : width;
}

/**
 * The dashboard's width, as the grid measured it, to the cards inside it: what a card that is
 * drawn somewhere else as well, as its settings panel's preview is, reads its real width from
 * (`cardOuterWidth`). `undefined` outside a dashboard and before it is measured.
 */
const DashboardWidthContext = createContext<number | undefined>(undefined);

export const DashboardWidthProvider: Provider<number | undefined> =
  DashboardWidthContext.Provider;

/** The width of the dashboard this is drawn in, or `undefined`; see `DashboardWidthContext`. */
export function useDashboardWidthAround(): number | undefined {
  return useContext(DashboardWidthContext);
}
