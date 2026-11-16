"use client";

/**
 * What the visible cards need fetched, and what the grid says once it lands.
 *
 * Extracted from the grid, which had grown three subjects — what the cards ARE,
 * how they are ARRANGED, and what they need FETCHED — and the complexity gate
 * objected before a reader would have. This is the third; `useDashboardArrangement`
 * is the second.
 *
 * Every card is a widget declared with `defineWidget`, answered on the server
 * from its declaration's `load`, so each one asks one thing: its own card, by
 * its id (`cardAskFor`).
 *
 * @module components/features/widgets/useWidgetBatch
 */

import type { SizeTier } from "@nextlyhq/ui/format";
import { useEffect, useMemo } from "react";

import {
  useWidgetQueries,
  type AskedWith,
  type WidgetQueryRequest,
} from "@admin/hooks/queries/useWidgetQueries";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import { DREW_NOTHING } from "./draw-failures";
import { resolveWidgetOutcome } from "./outcome";
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
   * before the card can measure itself. With its width and height, the size its widget's `load`
   * is handed (`cardAskFor`); absent for a card drawn somewhere with no dashboard width, which is
   * asked with no size.
   */
  tier?: SizeTier;
  /** The card's height in grid rows, as it is drawn; absent where its tier is. */
  h?: number;
  /** The card's width in grid columns, as it is drawn; absent where its tier is. */
  w?: number;
  /** The settings this reader stored for the card, as the arrangement holds them. */
  config?: Record<string, unknown>;
  /**
   * Set while the dashboard is being customised: the card's settings may then
   * be a change not yet saved, or the card itself one not yet saved, so it is
   * asked with the settings it is drawn with rather than by its id.
   */
  editing?: true;
}

export interface WidgetBatch {
  slots: Record<string, WidgetSlot>;
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
   * Reload one card: its question is asked again on its own, so Retry asks for that card and no
   * other. Until the batch next refreshes, the card shows this answer.
   */
  retry: (placementId: string) => void;
  /** When the answer one card shows arrived: its own retry's, or the batch's. */
  updatedAtFor: (placementId: string) => Date | null;
  /** When one card's own answer arrived: its own retry's, or its own request's in the batch. */
  answeredAtFor: (placementId: string) => Date | null;
  /**
   * What the answer one card shows was asked with (`useCardRetries`), its size and settings,
   * which a card that grew or changed density draws that answer by until its new one arrives.
   */
  fetchedAskFor: (placementId: string) => AskedWith | undefined;
  /** Ask every card again, as the batch does on window focus. */
  refresh: () => void;
}

/**
 * How a card is asked for: by its id while it is a stored card with its stored
 * settings, filed under those settings so a saved change of them asks it again
 * alone; with the settings it is drawn with while the dashboard is being
 * customised, when either may not be saved yet.
 *
 * With the size it is drawn at, where the dashboard has a width to predict its
 * tier from: the widget's `load` is handed it, so a card resized or crossing a
 * tier is a different question, filed under it and asked again alone
 * (`cardSize`). Core answers the card from its declaration, which reads the
 * size if it wants it.
 *
 * 🔴 Every card the batch holds is asked for, an archetype this release cannot
 * draw included: it is the server that answers whether the reader may see it,
 * and the card says what it cannot draw (`resolveWidgetOutcome`).
 */
function cardAskFor(card: BatchCard): WidgetQueryRequest {
  const widget = card.widget.id;
  const { tier, w, h } = card;
  const size =
    tier === undefined || w === undefined || h === undefined
      ? {}
      : { cardSize: { w, h, tier } };
  if (card.editing === true) {
    return {
      placementId: card.placementId,
      card: { widget, settings: card.config ?? {} },
      ...size,
    };
  }
  return {
    placementId: card.placementId,
    card: { widget, card: card.placementId },
    ...(card.config === undefined ? {} : { config: card.config }),
    ...size,
  };
}

/** No card's component has failed to draw. */
const NO_DRAW_FAILURES: ReadonlySet<string> = new Set();

/**
 * `drawFailed` is the placements whose own component threw drawing a fine
 * answer (`draw-failures`): the answer cannot say so, so they are counted as
 * failed from here. `readAheadToken` is the token of the layout answer the
 * cards are drawn from: the batch is asked under it, and again, once, under
 * each new one (`useWidgetQueries`).
 */
export function useWidgetBatch(
  cards: BatchCard[],
  drawFailed: ReadonlySet<string> = NO_DRAW_FAILURES,
  readAheadToken?: string
): WidgetBatch {
  // 🔴 Sorted by placement id, not left in display order. `useWidgetQueries` puts the
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
        .map(cardAskFor)
        .sort((a, b) => a.placementId.localeCompare(b.placementId)),
    [cards]
  );

  const batch = useWidgetQueries(requests, readAheadToken);
  const { isFetching, updatedAt } = batch;

  // Retry for one card at a time, over the batch's answers; see `useCardRetries`.
  const retries = useCardRetries(requests, batch);
  const { retry, updatedAtFor, grow, slots } = retries;

  // Each card's own request in flight: the batch's partition, or its own re-ask.
  const fetchingPlacementIds = useMemo(
    () =>
      new Set([...batch.fetchingPlacementIds, ...retries.fetchingPlacementIds]),
    [batch.fetchingPlacementIds, retries.fetchingPlacementIds]
  );

  // A card that now asks other than its answer was fetched with -- resized, crossed a tier, or
  // its stored settings changed -- asks again, alone. Each card is offered on every change, and
  // `grow` judges it against what its shown answer was asked with, so a card is never asked
  // again for a question it already has the answer to.
  useEffect(() => {
    for (const request of requests) grow(request);
  }, [requests, slots, grow]);

  // Which cards are actually IN the batch, taken from the requests that were
  // sent, so a card's freshness line and busy state describe a request that ran.
  const requested = useMemo(
    () => new Set(requests.map(request => request.placementId)),
    [requests]
  );

  // The same answer the cards are drawn from, so the announcement cannot
  // describe a dashboard other than the one on screen. Counting slots instead
  // said "3 of 3 widgets updated" while a card read "the list archetype is not
  // rendered yet": the response was fine and the card was not.
  //
  // Every card asks, so every card is counted, by the outcome it draws. A
  // component that threw drawing a fine answer counts as the failure it shows.
  const outcomes = useMemo(
    () =>
      cards
        .map(card => {
          const outcome = resolveWidgetOutcome(
            card.widget,
            slots[card.placementId]
          );
          return outcome.state === "answered" &&
            drawFailed.has(card.placementId)
            ? ({ state: "failed", message: DREW_NOTHING } as const)
            : outcome;
        })
        // An unavailable card is neither updated nor failed, so it is left out of the
        // announcement rather than counted as "updated" beside a card that says otherwise.
        .filter(
          outcome =>
            outcome.state !== "unavailable" &&
            // Left out of this person's dashboard, so not one of its cards to count.
            outcome.state !== "not-shown"
        ),
    [cards, slots, drawFailed]
  );

  return {
    slots,
    isFetching,
    fetchingPlacementIds,
    updatedAt,
    requested,
    counted: outcomes.length,
    failed: outcomes.filter(outcome => outcome.state === "failed").length,
    settling: outcomes.some(outcome => outcome.state === "loading"),
    retry,
    updatedAtFor,
    answeredAtFor: retries.answeredAtFor,
    fetchedAskFor: retries.fetchedAskFor,
    refresh: () => void batch.refetch(),
  };
}
