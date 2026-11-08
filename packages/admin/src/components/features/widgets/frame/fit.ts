"use client";

/**
 * A card whose content needs less than its stored rows give it, drawn to its content rather than
 * stretched to its rows: a list card holding one item, beside a card whose row it shares.
 *
 * A card keeps the rows its placement stores, and a row of the default dashboard gives the cards
 * beside each other one height (Needs attention and Upcoming releases, `pairHasItsOwnRow` in
 * core). A body that would then sit above empty room may report the body height its content
 * takes; the cell draws its card at that height in one of two ways, so no other card's place or
 * height changes:
 *
 * - drawn across the whole row (every card in the narrow bands, and the lone card of the pair),
 *   the cell spans the fewest rows that hold its content, never fewer than its widget's minimum.
 *   No card shares those rows, so the cards below only move up, in their order.
 * - drawn beside another card, the cell keeps its rows, so every card's place stays as it was,
 *   and is aligned to the top of them at its own height ({@link FITS_CONTENT_CLASS}). The cards
 *   beside it keep their height.
 *
 * Only a body certain that all of its content fits its stored rows reports it, since a card drawn
 * at its content's height has no body edge to fold rows behind. Nothing is written to the layout,
 * and never in customise mode, where the card's stored size is what is being edited.
 *
 * @module components/features/widgets/frame/fit
 */

import { drawnSpan, rowsThatFit } from "nextly/card-geometry";
import { GRID_COLUMNS, MIN_GRID_ROWS, type ListDensity } from "nextly/config";
import {
  createContext,
  useContext,
  useLayoutEffect,
  type RefObject,
} from "react";

import { cardBodyHeightPx } from "./measures";

/** Report the body height a card's content takes, in pixels, or `undefined` for its own rows. */
export type ReportFitHeight = (bodyPx: number | undefined) => void;

/** Where a card's body reports the height its content takes; absent outside a cell that fits. */
export const CardFitContext = createContext<ReportFitHeight | undefined>(
  undefined
);

/**
 * Asks the cell to draw the card at the height of `content`, the element holding everything the
 * body draws, while `fits` holds; at its stored rows otherwise, and once the body unmounts, as
 * when the card's state replaces the body. Measured before the paint (a layout effect), again
 * whenever `contentKey` changes: what the body draws, such as its number of rows. The element is
 * as tall as what it holds whatever the card's height, so drawing the card at that height asks
 * for the same height again rather than another.
 */
export function useCardFitsContent(
  content: RefObject<HTMLElement | null>,
  fits: boolean,
  contentKey: unknown
): void {
  const report = useContext(CardFitContext);
  useLayoutEffect(() => {
    const element = content.current;
    report?.(fits && element !== null ? element.offsetHeight : undefined);
  }, [report, content, fits, contentKey]);
  useLayoutEffect(() => () => report?.(undefined), [report]);
}

/**
 * Whether a list of `count` rows at `density` leaves at least one whole row of a card stored `h`
 * rows high empty (`rowsThatFit`, core's count of the rows its body holds): the list a card may be
 * fitted to (`useCardFitsContent`). No for a card of unknown height, and for a list that fills its
 * body or folds, which keeps the height of the cards beside it.
 */
export function leavesRowsEmpty(
  count: number,
  h: number | undefined,
  density: ListDensity
): boolean {
  return h !== undefined && count < rowsThatFit({ h }, { density });
}

/**
 * The classes a cell drawn beside another card takes to stand at its content's height: aligned
 * to the top of its rows rather than stretched down them, and never taller than they are, so a
 * content taller than reported is cut at the card's own rows rather than drawn over the next.
 */
export const FITS_CONTENT_CLASS = "self-start max-h-full";

/** How a cell draws its card: the rows it spans, and whether it stands at its content's height. */
export interface FittedCell {
  rows: number;
  alignStart: boolean;
}

/**
 * How a cell stored at `storedRows` draws a card whose body reports `bodyPx`: at its stored rows,
 * stretched, while the body reports nothing or needs all of them; else, across the whole row
 * (`fullRow`), the fewest rows from `minRows` whose body (`cardBodyHeightPx`) holds `bodyPx`, and
 * beside another card its stored rows at its content's height.
 */
export function fittedCell(
  storedRows: number,
  bodyPx: number | undefined,
  placed: { fullRow: boolean; minRows: number }
): FittedCell {
  const stretched = { rows: storedRows, alignStart: false };
  if (bodyPx === undefined || !Number.isFinite(bodyPx)) return stretched;
  if (bodyPx >= cardBodyHeightPx(storedRows)) return stretched;
  if (!placed.fullRow) return { rows: storedRows, alignStart: true };
  let rows = Math.max(placed.minRows, MIN_GRID_ROWS);
  while (rows < storedRows && cardBodyHeightPx(rows) < bodyPx) rows += 1;
  return { rows: Math.min(rows, storedRows), alignStart: false };
}

/**
 * Whether a card of `w` columns is drawn across the whole row of a dashboard `dashboardWidth`
 * wide (`drawnSpan`), and so has its rows to itself. No before the dashboard is measured, which
 * reads it as sharing its row, where fitting it moves no other card.
 */
export function drawnAcrossWholeRow(
  w: number,
  dashboardWidth: number | undefined
): boolean {
  return (
    dashboardWidth !== undefined &&
    drawnSpan(w, dashboardWidth) === GRID_COLUMNS
  );
}
