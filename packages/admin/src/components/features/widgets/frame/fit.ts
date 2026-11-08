"use client";

/**
 * A card whose content needs less than its stored rows give it, drawn at its content's height
 * rather than stretched to its rows: a list card holding one item.
 *
 * Outside customise mode the dashboard's rows take the height of what is drawn in them
 * (`dashboardGridClass`), so a card's stored size is the most it is drawn at, not what it is
 * always drawn at. Every cell keeps the rows its card spans, so every card lands in the same row
 * and columns as in customise mode; only how tall those rows are changes. Each cell asks the rows
 * it spans for one height ({@link requestedCardHeightPx}): the height of the card holding what its
 * body reports it draws, or, for a body that reports nothing, its stored height. The rows are as
 * tall as the tallest request among the cards that share them, and every card in them is
 * stretched to that height ({@link CONTENT_SIZED_CELL_CLASS}), so cards side by side keep one
 * height and their bottoms meet.
 *
 * Only a body certain that all of its content fits its stored rows reports it, since a card drawn
 * at its content's height has no body edge to fold rows behind: a list that fills its body, or
 * folds rows behind "Show N more", keeps its stored height. While one of the widgets whose bodies
 * report (`CONTENT_SIZED_WIDGETS`) is loading, its cell asks for the height a one-item answer
 * takes ({@link useLoadingFitsOneItem}), so the common answer lands at the height the loading
 * card already stood at and nothing below it moves. Nothing is written to the layout, and
 * never in customise mode, where the rows are fixed and the card's stored size is what is being
 * edited.
 *
 * @module components/features/widgets/frame/fit
 */

import type { ListDensity } from "nextly/config";
import {
  createContext,
  useContext,
  useLayoutEffect,
  type CSSProperties,
  type RefObject,
} from "react";

import { CONTENT_SIZED_WIDGETS } from "../content-sized";
import { cardHeightPx, cardRowStyle } from "../sizes";

import { LIST_ROW_HEIGHT_PX, rowsInBody, useListDensity } from "./list-rows";
import { cardBodyHeightPx } from "./measures";
import { CardHeightContext } from "./tier";

/** Report the body height a card's content takes, in pixels, or `undefined` for its own rows. */
export type ReportFitHeight = (bodyPx: number | undefined) => void;

/** Where a card's body reports the height its content takes; absent outside a cell that fits. */
export const CardFitContext = createContext<ReportFitHeight | undefined>(
  undefined
);

/**
 * Asks the cell to draw the card at the height of `content`, the element holding everything the
 * body draws, while `fits` holds; at its stored rows otherwise, and once the body unmounts, as
 * when the card's state replaces the body.
 *
 * Measured before the paint (a layout effect), again whenever `contentKey` changes (what the body
 * draws, such as its number of rows), and whenever the element changes size, as when a narrower
 * card wraps a row's text. Rounded up, so the card is never a fraction of a pixel shorter than
 * its content, which would cut the last row. The element is as tall as what it holds whatever the
 * card's height, so drawing the card at that height asks for the same height again rather than
 * another.
 */
export function useCardFitsContent(
  content: RefObject<HTMLElement | null>,
  fits: boolean,
  contentKey: unknown
): void {
  const report = useContext(CardFitContext);
  useLayoutEffect(() => {
    if (report === undefined) return;
    const element = content.current;
    if (!fits || element === null) {
      report(undefined);
      return;
    }
    const measure = () =>
      report(Math.ceil(element.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [report, content, fits, contentKey]);
  useLayoutEffect(() => () => report?.(undefined), [report]);
}

/**
 * The body height a one-item answer of a content-sized card takes at `density`: one list row,
 * which every `EntityRow` is drawn in (`LIST_ROW_HEIGHT_CLASS`, whose pixels these are). What the
 * loading card asks for (`useLoadingFitsOneItem`), and what the answered card then measures for
 * its one row, so the two are one height. A single row has no hairline above it, and Upcoming
 * releases' attention line is drawn only for stopped or overdue releases, which a lone scheduled
 * release does not have, so neither is counted.
 */
export function oneItemBodyPx(density: ListDensity): number {
  return LIST_ROW_HEIGHT_PX[density];
}

/**
 * While the card of `widgetId` is loading, asks its cell for the height a one-item answer takes
 * ({@link oneItemBodyPx}) where it is one of the content-sized widgets (`CONTENT_SIZED_WIDGETS`),
 * and only where that one item would leave a row of its stored body empty, as the answered body
 * reports by ({@link leavesRowsEmpty}); its stored height otherwise. Withdrawn in a layout effect's
 * cleanup as the loading state leaves, before the body that replaces it reports in its own, so
 * the cell is asked once per commit and a one-item answer asks for the height already drawn.
 *
 * Answers whether it asked, so the skeleton holds the place of the one row the card is drawn
 * tall enough for rather than of rows past its foot.
 */
export function useLoadingFitsOneItem(widgetId: string | undefined): boolean {
  const report = useContext(CardFitContext);
  const storedRows = useContext(CardHeightContext);
  const density = useListDensity();
  // Only where a cell takes the request: a card drawn with no cell to tell, as the settings
  // sheet's preview is at its stored height, keeps its full skeleton rather than one row in a
  // tall, mostly blank card.
  const fits =
    report !== undefined &&
    widgetId !== undefined &&
    CONTENT_SIZED_WIDGETS.has(widgetId) &&
    leavesRowsEmpty(1, storedRows, density);
  useLayoutEffect(() => {
    if (report === undefined) return;
    report(fits ? oneItemBodyPx(density) : undefined);
    return () => report(undefined);
  }, [report, fits, density]);
  return fits;
}

/**
 * Whether a list of `count` rows at `density` leaves at least one whole row of a card stored `h`
 * rows high empty: fewer rows than its body holds (`rowsInBody` of `cardBodyHeightPx`, core's
 * count of them), less `reservedPx` the body gives something drawn above the rows. The list a
 * card may be fitted to (`useCardFitsContent`). No for a card of unknown height, and for a list
 * that fills its body, which keeps the card's stored height.
 */
export function leavesRowsEmpty(
  count: number,
  h: number | undefined,
  density: ListDensity,
  reservedPx = 0
): boolean {
  return (
    h !== undefined &&
    count < rowsInBody(cardBodyHeightPx(h) - reservedPx, density)
  );
}

/**
 * The height a cell spanning `rows` asks of the rows it spans, in pixels, when its body reports
 * `bodyPx`: the card that holds that body (the frame around the body, `cardHeightPx` less
 * `cardBodyHeightPx`, and the body), never taller than the card's own rows draw it on fixed rows
 * (`cardHeightPx`). That height for a body that reports nothing, so such a card holds its rows at
 * the height customise mode draws them.
 */
export function requestedCardHeightPx(
  rows: number,
  bodyPx: number | undefined
): number {
  const stored = cardHeightPx(rows);
  if (bodyPx === undefined || !Number.isFinite(bodyPx) || bodyPx < 0) {
    return stored;
  }
  const frame = stored - cardBodyHeightPx(rows);
  return Math.min(stored, Math.ceil(bodyPx) + frame);
}

/**
 * A cell's style: the rows it spans (`cardRowStyle`), and, on rows that take their content's
 * height, the height it asks of them (`requestPx`) as its minimum. Its span alone where the rows
 * are fixed (`requestPx` undefined), as in customise mode.
 */
export function cellRowStyle(
  rows: number,
  requestPx: number | undefined
): CSSProperties {
  const span = cardRowStyle(rows);
  return requestPx === undefined
    ? span
    : { ...span, minHeight: `${requestPx}px` };
}

/**
 * The class a cell takes on rows that take their content's height. Size containment makes the
 * cell's own content count for nothing in the height it asks of its rows, so its minimum height
 * ({@link cellRowStyle}) is the whole request and a body taller than reported can never make a row
 * taller; the cell is then stretched down its rows, the grid's default, so it is as tall as the
 * row's tallest request.
 */
export const CONTENT_SIZED_CELL_CLASS = "contain-size";
