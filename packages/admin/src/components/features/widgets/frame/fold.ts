"use client";

/**
 * How many of a card's rows it draws: only whole rows, as many as its body holds, then
 * "Show N more" for the rest, which grows the card in place until "Show less". Used by every card
 * that folds its rows rather than linking to a full list: Get started's steps, Needs attention's
 * items.
 *
 * A card keeps the rows its placement stores and never scrolls, so a row past the body's edge
 * was cut off. Measured in the browser, not worked out from a table of heights: a row is taller
 * where its actions wrap, and wraps at some widths and not others.
 *
 * @module components/features/widgets/frame/fold
 */

import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

import { CardGrowContext } from "./grow";

/**
 * How many rows fit, whole: every one when the last ends within `limit`, or else those that end
 * within `limit` less `reserve`, the room the control that shows the rest takes below them.
 *
 * `rowBottoms` are where each row ends, in order, measured from the same origin as
 * `limit`.
 */
export function rowsThatFit(
  rowBottoms: readonly number[],
  limit: number,
  reserve: number
): number {
  const last = rowBottoms[rowBottoms.length - 1];
  if (last === undefined || last <= limit) return rowBottoms.length;
  let shown = 0;
  while (shown < rowBottoms.length && rowBottoms[shown] <= limit - reserve) {
    shown += 1;
  }
  return shown;
}

/** The card body a list is drawn in. */
function bodyOf(element: Element | null): HTMLElement | null {
  return (
    element?.closest<HTMLElement>('[data-testid="widget-card-body"]') ?? null
  );
}

/**
 * Whole rows that fit the body, measured with every row and the control drawn. A row is an
 * element marked `data-fold-row`; nothing else in the list is counted. A control drawn in the
 * card's footer (`CardFooterContent`), whose room the frame keeps for every card, takes none of
 * the body's: only one drawn in the body below the rows is reserved for.
 */
function measuredFit(
  list: HTMLElement | null,
  control: HTMLElement | null,
  total: number
): number {
  const body = bodyOf(list);
  const rows = list ? [...list.querySelectorAll("[data-fold-row]")] : [];
  if (body === null || rows.length === 0) return total;
  const bottoms = rows.map(row => row.getBoundingClientRect().bottom);
  const last = bottoms[bottoms.length - 1];
  const reserve =
    control === null || last === undefined || !body.contains(control)
      ? 0
      : control.getBoundingClientRect().bottom - last;
  return rowsThatFit(bottoms, body.getBoundingClientRect().bottom, reserve);
}

export interface RowFold {
  /** The element holding the rows and the control, and whatever the body draws above them. */
  listRef: RefObject<HTMLDivElement | null>;
  /** The control that shows the rest, or fewer. */
  controlRef: RefObject<HTMLButtonElement | null>;
  /** The rows to draw: every one while measuring or shown in full. */
  shown: number;
  /** Whether the reader has asked for every row. */
  expanded: boolean;
  /** Whether to draw the control: while measuring, when rows are folded, and when shown in full. */
  hasControl: boolean;
  toggle: () => void;
}

export function useRowFold(total: number): RowFold {
  const listRef = useRef<HTMLDivElement | null>(null);
  const controlRef = useRef<HTMLButtonElement | null>(null);
  const report = useContext(CardGrowContext);
  const [expanded, setExpanded] = useState(false);
  // `undefined` while measuring: every row and the control are drawn, then measured before the
  // paint, so no frame with a cut row is ever shown.
  const [fit, setFit] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    setFit(undefined);
  }, [total]);

  useLayoutEffect(() => {
    if (expanded || fit !== undefined) return;
    setFit(measuredFit(listRef.current, controlRef.current, total));
  }, [expanded, fit, total]);

  // Measured again whenever the body changes size: a resize, a band, a width that wraps a row.
  useEffect(() => {
    const body = bodyOf(listRef.current);
    if (body === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setFit(undefined));
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  // Shown in full, the card asks its cell for the body height its rows need; folded, for none.
  useLayoutEffect(() => {
    if (report === undefined) return;
    const list = listRef.current;
    const body = bodyOf(list);
    if (!expanded || list === null || body === null) {
      report(undefined);
      return;
    }
    const above =
      list.getBoundingClientRect().top - body.getBoundingClientRect().top;
    report(above + list.offsetHeight);
  }, [expanded, report, total]);
  useEffect(() => () => report?.(undefined), [report]);

  const measuring = fit === undefined;
  const shown = expanded || measuring ? total : fit;
  return {
    listRef,
    controlRef,
    shown,
    expanded,
    hasControl: expanded || measuring || fit < total,
    toggle: () => {
      // Folding: the cell goes back to its own rows in the same render as the measuring pass,
      // so the rows are measured against the body they will be drawn in.
      if (expanded) report?.(undefined);
      setExpanded(open => !open);
      setFit(undefined);
    },
  };
}
