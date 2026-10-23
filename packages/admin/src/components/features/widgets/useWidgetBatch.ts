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

import type { SizeTier } from "@nextlyhq/ui/format";
import { useEffect, useMemo } from "react";

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
import { queryForTier } from "./tier-query";
import { useCardRetries } from "./useCardRetries";

/**
 * One card in the batch: which placement asked, and what it is asking.
 *
 * 🔴 The batch takes PLACEMENTS rather than widgets, because a widget is not
 * what a question belongs to. The same widget can sit on a dashboard twice with
 * different settings, so two placements of it ask two different questions and
 * must receive two different answers. `ArrangedWidget` already satisfies this
 * shape, so the grid passes its rows through unchanged.
 */
export interface BatchCard {
  placementId: string;
  widget: DashboardWidget;
  /**
   * The tier the card is drawn at, predicted from the dashboard's width and the card's span
   * before the card can measure itself. Sizes its query (see `queryForTier`); absent for a card
   * drawn somewhere with no dashboard width, whose query is asked as declared.
   */
  tier?: SizeTier;
  /**
   * The widget's query as DECLARED, when the card's settings change it: `widget` is then the
   * widget as its settings ask it. The batch keys the card by this and sends `widget.query`, so
   * one card's change of settings is not a new question for the whole dashboard. Absent when
   * nothing applies, and the card is keyed by what it asks.
   */
  declaredQuery?: DashboardWidget["query"];
}

export interface WidgetBatch {
  slots: Record<string, WidgetSlot>;
  /** A `stats` card's answers, by placement id then cell key. */
  cellSlots: CellSlots;
  isFetching: boolean;
  /** The placements whose own request is still in flight. */
  fetchingPlacementIds: ReadonlySet<string>;
  updatedAt: Date | null;
  /** Which PLACEMENTS took part in the batch at all. */
  requested: ReadonlySet<string>;
  /** How many cards the announcement should describe, and how many failed. */
  counted: number;
  failed: number;
  settling: boolean;
  /**
   * Reload one card: its question is asked again on its own, so Retry sends that card's query
   * and no other card's. Until the batch next refreshes, the card shows this answer.
   */
  retry: (placementId: string) => void;
  /** When the answer one card shows arrived: its own retry's, or the batch's. */
  updatedAtFor: (placementId: string) => Date | null;
  /**
   * The tier the answer one card shows was fetched at. A card that grew keeps a smaller answer
   * on screen until a larger one lands, and draws no more rows than that answer was asked for.
   */
  fetchedTierFor: (placementId: string) => SizeTier | undefined;
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
function questionsFor(card: BatchCard): WidgetQueryRequest[] {
  const { placementId, widget } = card;
  if (widget.cells?.length) {
    return widget.cells.map(cell => ({
      placementId,
      cellKey: cell.key,
      query: cell.query,
    }));
  }
  if (!widget.query) return [];
  // Sized for a card the host draws, whose body slices to its tier, and for a custom card
  // that asked to be (`sizedQuery`), whose component draws by the same rule. Any other
  // custom card's component draws the raw answer with no tier, so it is asked exactly as
  // declared: sized, it would draw the extra row as an ordinary one.
  const tier =
    widget.archetype === "custom" && widget.sizedQuery !== true
      ? undefined
      : card.tier;
  // Keyed by the declared question and sent as the settings ask it; see `declaredQuery`.
  const declared = card.declaredQuery ?? widget.query;
  return [
    {
      placementId,
      query: declared,
      ...(declared === widget.query ? {} : { applied: widget.query }),
      ...(tier
        ? { sized: { query: queryForTier(widget.query, tier), tier } }
        : {}),
    },
  ];
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

export function useWidgetBatch(cards: BatchCard[]): WidgetBatch {
  // 🔴 Sorted by ID, not left in display order. `useWidgetQueries` puts the
  // request partitions into its TanStack query keys, so a key built from the
  // visual arrangement CHANGES every time a card moves — and every drag or
  // button press re-issued the whole batch, spending access-checked database
  // reads and blanking cards mid-edit, though not one data question had
  // changed. A stable identity order makes the key describe what is being
  // asked rather than where it happens to sit; results are keyed back by
  // placement id, which never depended on order.
  const requests = useMemo<WidgetQueryRequest[]>(
    () =>
      cards
        .filter(card => worthAsking(card.widget))
        .flatMap(questionsFor)
        // By placement id, then by cell key: the pair identifies a question,
        // and a stable order keeps the query key describing WHAT is asked
        // rather than the order the cards happen to sit in. Sorting on the
        // placement alone left a card's cells in whatever order `flatMap`
        // produced, which is stable today and is not a property the query key
        // should rest on.
        .sort(
          (a, b) =>
            a.placementId.localeCompare(b.placementId) ||
            (a.cellKey ?? "").localeCompare(b.cellKey ?? "")
        ),
    [cards]
  );

  const batch = useWidgetQueries(requests);
  const { isFetching, updatedAt } = batch;

  // Retry for one card at a time, over the batch's answers; see `useCardRetries`.
  const retries = useCardRetries(requests, batch);
  const { slots, cellSlots, retry, updatedAtFor, grow, fetchedTierFor } =
    retries;

  // Each card's own request in flight: the batch's partition, or its own re-ask.
  const fetchingPlacementIds = useMemo(
    () =>
      new Set([...batch.fetchingPlacementIds, ...retries.fetchingPlacementIds]),
    [batch.fetchingPlacementIds, retries.fetchingPlacementIds]
  );

  // A card that now draws more than its answer was fetched for asks again, alone. Each card is
  // offered on every change, and `grow` judges it against the tier its shown answer was fetched
  // at, so a card is never asked again for a tier it already has; a card whose tier shrinks
  // draws a prefix of what it holds and asks nothing.
  useEffect(() => {
    for (const request of requests) grow(request);
  }, [requests, slots, grow]);

  // Which cards are actually IN the batch, taken from the requests that were
  // sent rather than re-derived from `widget.query`.
  //
  // Those two disagree, and the disagreement is the point: a widget declaring a
  // query whose archetype nothing can draw is deliberately left out of the
  // batch above, but it still HAS a `widget.query`. Testing that field again
  // gave such a card a freshness line for a request that never ran, and marked
  // it `aria-busy` during someone else's refetch.
  const requested = useMemo(
    () => new Set(requests.map(request => request.placementId)),
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
      cards
        // A `stats` card is one CARD in the announcement, however many numbers
        // it draws: the reader is told how many cards updated, not how many
        // queries ran.
        .filter(card => card.widget.query ?? card.widget.cells?.length)
        .map(card =>
          widgetOutcome(
            card.widget,
            slots[card.placementId],
            cellSlots[card.placementId]
          )
        )
        // An unavailable card is neither updated nor failed, so it is left out of the
        // announcement rather than counted as "updated" beside a card that says otherwise.
        .filter(
          outcome =>
            outcome.state !== "self-drawn" && outcome.state !== "unavailable"
        ),
    [cards, slots, cellSlots]
  );

  return {
    slots,
    cellSlots,
    isFetching,
    fetchingPlacementIds,
    updatedAt,
    requested,
    counted: outcomes.length,
    failed: outcomes.filter(outcome => outcome.state === "failed").length,
    settling: outcomes.some(outcome => outcome.state === "loading"),
    retry,
    updatedAtFor,
    fetchedTierFor,
  };
}
