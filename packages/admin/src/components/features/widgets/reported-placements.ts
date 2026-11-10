"use client";

/**
 * A set of placements the cards themselves report into, which the grid reads.
 *
 * What only a card knows (its component failed to draw, or it is off the
 * dashboard) reaches the grid this way, so the grid counts from the card's own
 * decision rather than deciding it a second time.
 *
 * @module components/features/widgets/reported-placements
 */

import { useCallback, useState } from "react";

/** A card saying whether its placement is in the set. */
export type PlacementReport = (placementId: string, isIn: boolean) => void;

const NONE: ReadonlySet<string> = new Set();

/**
 * The placements reported in, and the report that keeps them. A report that
 * changes nothing keeps the same set, so what the grid derives from it is not
 * recomputed for it.
 */
export function useReportedPlacements(): {
  placements: ReadonlySet<string>;
  report: PlacementReport;
} {
  const [placements, setPlacements] = useState<ReadonlySet<string>>(NONE);
  const report = useCallback<PlacementReport>((placementId, isIn) => {
    setPlacements(current => {
      if (current.has(placementId) === isIn) return current;
      const next = new Set(current);
      if (isIn) next.add(placementId);
      else next.delete(placementId);
      return next;
    });
  }, []);
  return { placements, report };
}
