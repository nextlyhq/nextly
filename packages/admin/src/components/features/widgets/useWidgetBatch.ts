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
  type WidgetQueryRequest,
} from "@admin/hooks/queries/useWidgetQueries";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { coreDraws, resolveWidgetOutcome } from "./outcome";

export interface WidgetBatch {
  slots: Record<string, WidgetSlot>;
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
  if (!widget.query) return false;
  return widget.archetype === "custom" || coreDraws(widget);
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
        .map(widget => ({ widgetId: widget.id, query: widget.query! }))
        .sort((a, b) => a.widgetId.localeCompare(b.widgetId)),
    [widgets]
  );

  const { slots, isFetching, updatedAt } = useWidgetQueries(requests);

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
        .filter(widget => widget.query)
        .map(widget => resolveWidgetOutcome(widget, slots[widget.id]))
        .filter(outcome => outcome.state !== "self-drawn"),
    [widgets, slots]
  );

  return {
    slots,
    isFetching,
    updatedAt,
    requested,
    counted: outcomes.length,
    failed: outcomes.filter(outcome => outcome.state === "failed").length,
    settling: outcomes.some(outcome => outcome.state === "loading"),
  };
}
