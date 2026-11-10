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

/** A cell saying how many rows it is drawn across, or `undefined` for its stored rows. */
export type SpanReport = (
  placementId: string,
  rows: number | undefined
) => void;

const NO_SPANS: ReadonlyMap<string, number> = new Map();

/**
 * The rows each cell reported it is drawn across where that is not its stored rows (grown to
 * show more, or collapsed to one line), and the report that keeps them: a cell absent from the
 * map spans its stored rows, so the map and the stored sizes give every card's current span. A
 * report that changes nothing keeps the same map, as the set above does.
 */
export function useReportedSpans(): {
  spans: ReadonlyMap<string, number>;
  report: SpanReport;
} {
  const [spans, setSpans] = useState<ReadonlyMap<string, number>>(NO_SPANS);
  const report = useCallback<SpanReport>((placementId, rows) => {
    setSpans(current => {
      if (current.get(placementId) === rows) return current;
      const next = new Map(current);
      if (rows === undefined) next.delete(placementId);
      else next.set(placementId, rows);
      return next;
    });
  }, []);
  return { spans, report };
}
