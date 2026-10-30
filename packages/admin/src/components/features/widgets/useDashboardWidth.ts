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
  type Provider,
  type RefObject,
} from "react";

import { useMeasuredWidth } from "@admin/components/shared/preview/useMeasuredWidth";

/**
 * The width of the dashboard at `ref`.
 *
 * `undefined` rather than a guess until the first measure: a tier predicted from a guessed
 * width would size a query for a card the dashboard then draws at another tier.
 */
export function useDashboardWidth(
  ref: RefObject<HTMLElement | null>
): number | undefined {
  return useMeasuredWidth(ref) ?? undefined;
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
