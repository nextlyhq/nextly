"use client";

/**
 * What the visible cards need fetched, and what the grid says once it lands.
 *
 * Extracted from the grid, which had grown three subjects — what the cards ARE,
 * how they are ARRANGED, and what they need FETCHED — and the complexity gate
 * objected before a reader would have. This is the third; `useDashboardArrangement`
 * is the second.
 *
 * @module components/features/widgets/useWidgetBatch
 */

import { useMemo } from "react";

import {
  useWidgetQueries,
  type CellSlots,
  type WidgetQueryRequest,
} from "@admin/hooks/queries/useWidgetQueries";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { coreDraws, resolveWidgetOutcome, type WidgetOutcome } from "./outcome";

export interface WidgetBatch {
  slots: Record<string, WidgetSlot>;
  /** A `stats` card's answers, by widget id then cell key. */
  cellSlots: CellSlots;
  isFetching: boolean;
  updatedAt: Date | null;
  /** Whether this widget took part in the batch at all. */
  requested: ReadonlySet<string>;
  /** How many cards the announcement should describe, and how many failed. */
  counted: number;
  failed: number;
  settling: boolean;
}

/**
 * Whether asking for this widget's data can produce anything drawable.
 *
 * A query is only worth running if SOMETHING can draw its result. A widget
 * naming an archetype core cannot draw yet, and shipping no component to draw
 * it instead, resolves to a card reading "not rendered yet" — so asking spends
 * an access-checked read, and one of the batch's limited slots, on a result
 * thrown away on arrival. `custom` always draws, because the plugin's component
 * decides what to do with the slot.
 *
 * Asked of `coreDraws` rather than listed here, so the read starts happening on
 * its own the day core learns to draw one — and asked of the whole DECLARATION,
 * not just the archetype, because a renderer that will refuse this particular
 * widget makes the read just as wasted as no renderer at all.
 */
function worthAsking(widget: DashboardWidget): boolean {
  // A `stats` card asks through its CELLS, so it has no top-level query and the
  // original test declared every one of them not worth asking -- which is the
  // shape that would have shipped a card whose numbers never load.
  if (!widget.query && !widget.cells?.length) return false;
  return widget.archetype === "custom" || coreDraws(widget);
}

/**
 * The questions one widget contributes to the batch: one, or one per cell.
 *
 * 🔴 Flattened into the SAME array every other widget goes into, rather than a
 * second request of its own. The endpoint takes an array and answers
 * positionally, so six numbers cost six entries in one round trip -- and a card
 * that fetched separately would also be paging past `MAX_QUERIES_PER_REQUEST`
 * on its own, outside the partitioning that keeps the batch legal.
 */
function questionsFor(widget: DashboardWidget): WidgetQueryRequest[] {
  if (widget.cells?.length) {
    return widget.cells.map(cell => ({
      widgetId: widget.id,
      cellKey: cell.key,
      query: cell.query,
    }));
  }
  return widget.query ? [{ widgetId: widget.id, query: widget.query }] : [];
}

/**
 * One widget's outcome, whichever kind of answer it is waiting for.
 *
 * 🔴 A `stats` card is LOADING while any cell it asked for is still absent,
 * even though the card itself draws happily with the numbers it has. The two
 * consumers want different things, and conflating them broke the announcement:
 * partial rendering means the body returns `ready` on the first render, so the
 * grid announced "1 widget updated" before a single number had arrived -- and
 * the same sentence was then deduplicated when they actually did, so real
 * completion was never announced at all.
 */
export function widgetOutcome(
  widget: DashboardWidget,
  slot: WidgetSlot | undefined,
  answers: Record<string, WidgetSlot> | undefined
): WidgetOutcome {
  const cells = widget.cells ?? [];
  if (cells.length > 0 && cells.some(cell => !answers?.[cell.key])) {
    return { state: "loading" };
  }
  return resolveWidgetOutcome(widget, slot, key => answers?.[key]);
}

export function useWidgetBatch(widgets: DashboardWidget[]): WidgetBatch {
  // 🔴 Sorted by ID, not left in display order. `useWidgetQueries` puts the
  // request partitions into its TanStack query keys, so a key built from the
  // visual arrangement CHANGES every time a card moves — and every drag or
  // button press re-issued the whole batch, spending access-checked database
  // reads and blanking cards mid-edit, though not one data question had
  // changed. A stable identity order makes the key describe what is being
  // asked rather than where it happens to sit; results are keyed back by widget
  // id, which never depended on order.
  const requests = useMemo<WidgetQueryRequest[]>(
    () =>
      widgets
        .filter(worthAsking)
        .flatMap(questionsFor)
        // Sorted by the SLOT key rather than by widget id alone, so a card's
        // cells keep a stable order between renders. Sorting on the id left
        // siblings in whatever order `flatMap` produced, which is stable today
        // and is not a property the query key should rest on.
        // By widget id, then by cell key: the pair identifies a question, and
        // a stable order keeps the query key describing WHAT is asked rather
        // than the order the widgets happen to sit in.
        .sort(
          (a, b) =>
            a.widgetId.localeCompare(b.widgetId) ||
            (a.cellKey ?? "").localeCompare(b.cellKey ?? "")
        ),
    [widgets]
  );

  const { slots, cellSlots, isFetching, updatedAt } =
    useWidgetQueries(requests);

  // Which widgets are actually IN the batch, taken from the requests that were
  // sent rather than re-derived from `widget.query`.
  //
  // Those two disagree, and the disagreement is the point: a widget declaring a
  // query whose archetype nothing can draw is deliberately left out of the
  // batch above, but it still HAS a `widget.query`. Testing that field again
  // gave such a card a freshness line for a request that never ran, and marked
  // it `aria-busy` during someone else's refetch.
  const requested = useMemo(
    () => new Set(requests.map(request => request.widgetId)),
    [requests]
  );

  // The same answer the cards are drawn from, so the announcement cannot
  // describe a dashboard other than the one on screen. Counting slots instead
  // said "3 of 3 widgets updated" while a card read "the list archetype is not
  // rendered yet": the response was fine and the card was not.
  //
  // Only widgets that ASKED are counted, and self-drawn ones are dropped even
  // when they did. A plugin component decides what it shows from the slot it
  // was handed, so core cannot say whether it worked, and guessing either way
  // would put a number in the reader's ear that nothing on screen supports.
  const outcomes = useMemo(
    () =>
      widgets
        // A `stats` card is one CARD in the announcement, however many numbers
        // it draws: the reader is told how many cards updated, not how many
        // queries ran.
        .filter(widget => widget.query ?? widget.cells?.length)
        .map(widget =>
          widgetOutcome(widget, slots[widget.id], cellSlots[widget.id])
        )
        .filter(outcome => outcome.state !== "self-drawn"),
    [widgets, slots, cellSlots]
  );

  return {
    slots,
    cellSlots,
    isFetching,
    updatedAt,
    requested,
    counted: outcomes.length,
    failed: outcomes.filter(outcome => outcome.state === "failed").length,
    settling: outcomes.some(outcome => outcome.state === "loading"),
  };
}
