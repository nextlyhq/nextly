"use client";

/**
 * Retry for one card at a time, over the batch's answers.
 *
 * Pressing Retry asks that card's question again in a request of its own; while it is in flight
 * the card shows its skeleton, and once it answers the card keeps that answer, with the time it
 * arrived, until the whole batch next refreshes. A card whose retry has answered is no longer in
 * flight, so pressing Retry on another card asks that card alone -- a retry never re-asks the
 * cards retried before it, and never replaces their answers.
 *
 * @module components/features/widgets/useCardRetries
 */

import { useCallback, useEffect, useMemo, useReducer } from "react";

import {
  useWidgetQueries,
  type CellSlots,
  type WidgetQueryRequest,
} from "@admin/hooks/queries/useWidgetQueries";
import type { WidgetSlot } from "@admin/types/dashboard/widgets";

/** A retried card's answer, and when it arrived. */
interface SettledRetry {
  slot?: WidgetSlot;
  cells?: Record<string, WidgetSlot>;
  at: Date | null;
}

interface RetryState {
  /** Cards whose retry has not answered yet, with how many times Retry was pressed for each. */
  inFlight: ReadonlyMap<string, number>;
  /** Cards whose retry has answered, with that answer. */
  settled: ReadonlyMap<string, SettledRetry & { attempt: number }>;
}

type RetryAction =
  | { type: "press"; placementId: string }
  | { type: "arrived"; answers: Map<string, SettledRetry> }
  | { type: "reset" };

const EMPTY: RetryState = { inFlight: new Map(), settled: new Map() };

function reduce(state: RetryState, action: RetryAction): RetryState {
  switch (action.type) {
    case "press":
      return pressed(state, action.placementId);
    case "arrived":
      return arrived(state, action.answers);
    case "reset":
      return state.inFlight.size === 0 && state.settled.size === 0
        ? state
        : EMPTY;
  }
}

/** Retry pressed for one card: back in flight, its earlier answer dropped. */
function pressed(state: RetryState, placementId: string): RetryState {
  // The attempt keeps counting across presses, so every press is a new question to the cache,
  // even after a retry that answered (and was cached) under an earlier count.
  const previous =
    state.inFlight.get(placementId) ??
    state.settled.get(placementId)?.attempt ??
    0;
  const settled = new Map(state.settled);
  settled.delete(placementId);
  return {
    inFlight: new Map(state.inFlight).set(placementId, previous + 1),
    settled,
  };
}

/** Retries that answered: out of flight, each with its answer and its time. */
function arrived(
  state: RetryState,
  answers: Map<string, SettledRetry>
): RetryState {
  const inFlight = new Map(state.inFlight);
  const settled = new Map(state.settled);
  for (const [placementId, answer] of answers) {
    settled.set(placementId, {
      ...answer,
      attempt: inFlight.get(placementId) ?? 0,
    });
    inFlight.delete(placementId);
  }
  return { inFlight, settled };
}

export interface CardRetries {
  slots: Record<string, WidgetSlot>;
  cellSlots: CellSlots;
  /** Reload one card; see the module note. */
  retry: (placementId: string) => void;
  /** When the answer this card shows arrived: its retry's, or the batch's. */
  updatedAtFor: (placementId: string) => Date | null;
}

export function useCardRetries(
  requests: readonly WidgetQueryRequest[],
  batch: {
    slots: Record<string, WidgetSlot>;
    cellSlots: CellSlots;
    updatedAt: Date | null;
  }
): CardRetries {
  const [state, dispatch] = useReducer(reduce, EMPTY);

  // Only the cards still in flight are asked: a card whose retry has answered is not asked
  // again because another card's Retry was pressed.
  const retryRequests = useMemo(
    () =>
      requests
        .filter(request => state.inFlight.has(request.placementId))
        .map(request => ({
          ...request,
          attempt: state.inFlight.get(request.placementId),
        })),
    [requests, state.inFlight]
  );
  const retried = useWidgetQueries(retryRequests);

  // A retry that has answered moves out of flight with its answer and its time.
  //
  // The time is when THIS card's answer is seen, not the retry query's `updatedAt`: retries past
  // the endpoint's per-request cap are split into requests that settle separately, and that
  // aggregate stays `null` until the last one has, so a card from an earlier request would
  // never be dated. This runs on the render that brings the answer in, so it is the arrival.
  useEffect(() => {
    const answers = new Map<string, SettledRetry>();
    const seenAt = new Date(Date.now());
    for (const placementId of state.inFlight.keys()) {
      if (retried.fetchingPlacementIds.has(placementId)) continue;
      const slot = retried.slots[placementId];
      const cells = retried.cellSlots[placementId];
      if (!slot && !cells) continue;
      answers.set(placementId, { slot, cells, at: seenAt });
    }
    if (answers.size > 0) dispatch({ type: "arrived", answers });
  }, [
    state.inFlight,
    retried.fetchingPlacementIds,
    retried.slots,
    retried.cellSlots,
  ]);

  // The batch's next answer is fresher than any retry's, so a refresh of the whole batch ends
  // every retry and its cards go back to the batch's slots.
  // Keyed on the instant rather than the Date object, which may be a new object each render.
  const batchAnsweredAt = batch.updatedAt?.getTime() ?? null;
  useEffect(() => {
    dispatch({ type: "reset" });
  }, [batchAnsweredAt]);

  const retry = useCallback(
    (placementId: string) => dispatch({ type: "press", placementId }),
    []
  );

  const { slots, cellSlots } = useMemo(
    () =>
      mergeRetries({ slots: batch.slots, cellSlots: batch.cellSlots }, state, {
        slots: retried.slots,
        cellSlots: retried.cellSlots,
      }),
    [batch.slots, batch.cellSlots, state, retried.slots, retried.cellSlots]
  );

  const updatedAtFor = useCallback(
    (placementId: string) =>
      state.settled.get(placementId)?.at ?? batch.updatedAt,
    [state.settled, batch.updatedAt]
  );

  return { slots, cellSlots, retry, updatedAtFor };
}

/**
 * The batch's answers with each retried card's own: a settled retry's answer, or, while one is in
 * flight, nothing -- which draws the card's skeleton rather than the error it is retried from.
 */
function mergeRetries(
  batch: { slots: Record<string, WidgetSlot>; cellSlots: CellSlots },
  state: RetryState,
  retried: { slots: Record<string, WidgetSlot>; cellSlots: CellSlots }
): { slots: Record<string, WidgetSlot>; cellSlots: CellSlots } {
  if (state.inFlight.size === 0 && state.settled.size === 0) {
    return { slots: batch.slots, cellSlots: batch.cellSlots };
  }
  const slots: Record<string, WidgetSlot> = { ...batch.slots };
  const cellSlots: CellSlots = { ...batch.cellSlots };
  for (const placementId of state.inFlight.keys()) {
    delete slots[placementId];
    delete cellSlots[placementId];
    const slot = retried.slots[placementId];
    if (slot) slots[placementId] = slot;
    const cells = retried.cellSlots[placementId];
    if (cells) cellSlots[placementId] = cells;
  }
  for (const [placementId, answer] of state.settled) {
    delete slots[placementId];
    delete cellSlots[placementId];
    if (answer.slot) slots[placementId] = answer.slot;
    if (answer.cells) cellSlots[placementId] = answer.cells;
  }
  return { slots, cellSlots };
}
