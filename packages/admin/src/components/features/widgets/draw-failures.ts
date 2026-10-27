"use client";

/**
 * Which cards' own components threw while drawing an answer, as the grid
 * counts them.
 *
 * The grid counts each card's outcome from its answer, and a component that
 * throws has an answer that was fine: only the card knows its component then
 * failed. It says so here, so the grid counts that card as failed rather than
 * updated, and says so again when a later draw succeeds.
 *
 * @module components/features/widgets/draw-failures
 */

import { createContext, useCallback, useState } from "react";

/** What a throw while drawing says, in the card's own words. */
export const DREW_NOTHING = "Its component stopped while drawing.";

/** A card telling the grid whether its component failed to draw. */
export type DrawFailureReport = (placementId: string, failed: boolean) => void;

/** Where a card reports a failed draw; absent outside a grid. */
export const DrawFailureContext = createContext<DrawFailureReport | undefined>(
  undefined
);

const NONE: ReadonlySet<string> = new Set();

/**
 * The placements whose component failed to draw, and the report that keeps
 * them. A report that changes nothing keeps the same set, so the grid's
 * counts are not recomputed for it.
 */
export function useDrawFailures(): {
  failed: ReadonlySet<string>;
  report: DrawFailureReport;
} {
  const [failed, setFailed] = useState<ReadonlySet<string>>(NONE);
  const report = useCallback<DrawFailureReport>((placementId, didFail) => {
    setFailed(current => {
      if (current.has(placementId) === didFail) return current;
      const next = new Set(current);
      if (didFail) next.add(placementId);
      else next.delete(placementId);
      return next;
    });
  }, []);
  return { failed, report };
}
