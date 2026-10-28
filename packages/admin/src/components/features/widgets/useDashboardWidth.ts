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
import type { RefObject } from "react";

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
