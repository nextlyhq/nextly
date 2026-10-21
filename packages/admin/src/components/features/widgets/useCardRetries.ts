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
 * A card is also asked again on its own, quietly, when it now asks a different question than its
 * answer was fetched with: it grew into a tier drawing more rows, or its settings changed. It
 * keeps what it shows until the new answer arrives, and no other card is asked.
 *
 * @module components/features/widgets/useCardRetries
 */

import type { SizeTier } from "@nextlyhq/ui/format";
import { useCallback, useEffect, useMemo, useReducer } from "react";

import {
  appliedKey,
  useWidgetQueries,
  type CellSlots,
  type UseWidgetQueriesResult,
  type WidgetQueryRequest,
} from "@admin/hooks/queries/useWidgetQueries";
import type { WidgetSlot } from "@admin/types/dashboard/widgets";

import { asksAgainAt } from "./tier-query";

/** A retried card's answer, and when it arrived. */
interface SettledRetry {
  slot?: WidgetSlot;
  cells?: Record<string, WidgetSlot>;
  at: Date | null;
  /** The tier the answer was fetched at, which a later rise is judged against. */
  tier?: SizeTier;
  /** What the answer was asked with (`appliedKey`), which a change of settings is judged against. */
  applied?: string;
}

interface RetryState {
  /** Cards whose retry has not answered yet, with how many times Retry was pressed for each. */
  inFlight: ReadonlyMap<string, number>;
  /** Cards whose retry has answered, with that answer. */
  settled: ReadonlyMap<string, SettledRetry & { attempt: number }>;
  /**
   * In-flight cards asked again because they grew or their settings changed, not because Retry
   * was pressed, with what each now asks (`askingKey`): they keep what they were showing until
   * the new answer arrives, rather than drawing a skeleton.
   */
  quiet: ReadonlyMap<string, string>;
  /**
   * Cards whose quiet re-ask was refused, with what it asked. A refused re-ask keeps the answer
   * the card had, and the same question is not asked again on its own -- each refusal would
   * otherwise start the next request at once, without end. Retry, the batch's next answer, or a
   * different question clears it.
   */
  stalled: ReadonlyMap<string, string>;
}

type RetryAction =
  | { type: "press"; placementId: string }
  | {
      type: "grow";
      placementId: string;
      /** The query as the card's settings ask it, before sizing. */
      query: WidgetQueryRequest["query"];
      /** The tier the card is drawn at, for a sized card. */
      tier?: SizeTier;
      /** What the card asks with now (`appliedKey`). */
      applied: string;
      /** The tier the batch's answer for the card was fetched at. */
      batchFetchedAt: SizeTier | undefined;
      /** What the batch's answer for the card was asked with. */
      batchApplied: string | undefined;
    }
  | {
      type: "arrived";
      answers: Map<string, SettledRetry>;
      /** Quiet re-asks that were refused: out of flight, their card keeping what it had. */
      refused: ReadonlySet<string>;
    }
  | { type: "reset" };

const EMPTY: RetryState = {
  inFlight: new Map(),
  settled: new Map(),
  quiet: new Map(),
  stalled: new Map(),
};

function reduce(state: RetryState, action: RetryAction): RetryState {
  switch (action.type) {
    case "press":
      return pressed(state, action.placementId);
    case "grow":
      return grown(state, action);
    case "arrived":
      return arrived(state, action.answers, action.refused);
    case "reset":
      return state.inFlight.size === 0 &&
        state.settled.size === 0 &&
        state.stalled.size === 0
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
  const quiet = new Map(state.quiet);
  quiet.delete(placementId);
  const stalled = new Map(state.stalled);
  stalled.delete(placementId);
  return {
    inFlight: new Map(state.inFlight).set(placementId, previous + 1),
    settled,
    quiet,
    stalled,
  };
}

/** What a quiet re-ask asks, as one comparable value: the tier and the settings together. */
function askingKey(tier: SizeTier | undefined, applied: string): string {
  return `${tier ?? ""}\u0000${applied}`;
}

/**
 * A card that now asks more than, or other than, what its shown answer was fetched with: it grew
 * into a tier drawing more rows, or its settings changed. Asked again alone, keeping its answer on
 * screen until the new one arrives. Ignored while the card is already being asked again, when its
 * answer already serves it, and when the same question was just refused.
 *
 * Judged here, against the answer the card shows in THIS state, rather than by the caller: the
 * caller's view can be a render old, and a re-ask that answered in the same commit would
 * otherwise read as the batch's older answer and be asked again.
 */
function grown(
  state: RetryState,
  action: Extract<RetryAction, { type: "grow" }>
): RetryState {
  const { placementId } = action;
  if (state.inFlight.has(placementId)) return state;
  const asking = askingKey(action.tier, action.applied);
  if (state.stalled.get(placementId) === asking) return state;
  const settled = state.settled.get(placementId);
  if (!grewPast(settled, action) && !settingsChanged(settled, action)) {
    return state;
  }
  const previous = settled?.attempt ?? 0;
  // A different question is being asked, so an earlier refusal no longer stands: left in place,
  // it would keep that question from being asked again should the reader come back to it.
  const stalled = new Map(state.stalled);
  stalled.delete(placementId);
  return {
    inFlight: new Map(state.inFlight).set(placementId, previous + 1),
    settled: state.settled,
    quiet: new Map(state.quiet).set(placementId, asking),
    stalled,
  };
}

/** Whether the card now draws more rows than its shown answer was fetched for. */
function grewPast(
  settled: SettledRetry | undefined,
  action: Extract<RetryAction, { type: "grow" }>
): boolean {
  const fetchedAt = settled ? settled.tier : action.batchFetchedAt;
  return (
    action.tier !== undefined &&
    fetchedAt !== undefined &&
    asksAgainAt(action.query, fetchedAt, action.tier)
  );
}

/**
 * Whether the card's settings now ask other than its shown answer was asked with. Only once an
 * answer says what it was asked with: before then there is nothing to differ from, and the
 * first answer is the batch's own.
 */
function settingsChanged(
  settled: SettledRetry | undefined,
  action: Extract<RetryAction, { type: "grow" }>
): boolean {
  const fetchedWith = settled ? settled.applied : action.batchApplied;
  return fetchedWith !== undefined && fetchedWith !== action.applied;
}

/**
 * Retries that answered: out of flight, each with its answer and its time. A refused quiet
 * re-ask settles nothing: its card keeps the answer it had, stalled at the tier it grew to.
 */
function arrived(
  state: RetryState,
  answers: Map<string, SettledRetry>,
  refused: ReadonlySet<string>
): RetryState {
  const inFlight = new Map(state.inFlight);
  const settled = new Map(state.settled);
  const quiet = new Map(state.quiet);
  const stalled = new Map(state.stalled);
  for (const [placementId, answer] of answers) {
    settled.set(placementId, {
      ...answer,
      attempt: inFlight.get(placementId) ?? 0,
    });
    inFlight.delete(placementId);
    quiet.delete(placementId);
  }
  for (const placementId of refused) {
    const asking = quiet.get(placementId);
    if (asking !== undefined) stalled.set(placementId, asking);
    inFlight.delete(placementId);
    quiet.delete(placementId);
  }
  return { inFlight, settled, quiet, stalled };
}

/**
 * What the in-flight retries brought in on this render: each answered card's answer, and the
 * quiet re-asks that were refused, which must not replace the answer their card is showing.
 */
function arrivals(
  state: RetryState,
  retried: UseWidgetQueriesResult,
  seenAt: Date
): { answers: Map<string, SettledRetry>; refused: Set<string> } {
  const answers = new Map<string, SettledRetry>();
  const refused = new Set<string>();
  for (const placementId of state.inFlight.keys()) {
    if (retried.fetchingPlacementIds.has(placementId)) continue;
    const slot = retried.slots[placementId];
    const cells = retried.cellSlots[placementId];
    if (!slot && !cells) continue;
    if (state.quiet.has(placementId) && slot?.ok === false) {
      refused.add(placementId);
      continue;
    }
    answers.set(placementId, {
      slot,
      cells,
      at: seenAt,
      tier: retried.fetchedTierFor(placementId),
      applied: retried.fetchedAppliedFor(placementId),
    });
  }
  return { answers, refused };
}

export interface CardRetries {
  slots: Record<string, WidgetSlot>;
  cellSlots: CellSlots;
  /** Reload one card; see the module note. */
  retry: (placementId: string) => void;
  /** When the answer this card shows arrived: its retry's, or the batch's. */
  updatedAtFor: (placementId: string) => Date | null;
  /** Ask one card again if it now asks more, or other, than its answer was fetched for; see `grown`. */
  grow: (request: WidgetQueryRequest) => void;
  /**
   * The cards being asked again, by Retry or because they grew. A quiet re-ask keeps the answer
   * on screen, so without this a card refreshing for its new tier would not say it is reading.
   */
  fetchingPlacementIds: ReadonlySet<string>;
  /** The tier the answer this card shows was fetched at: its own re-ask's, or the batch's. */
  fetchedTierFor: (placementId: string) => SizeTier | undefined;
}

export function useCardRetries(
  requests: readonly WidgetQueryRequest[],
  batch: {
    slots: Record<string, WidgetSlot>;
    cellSlots: CellSlots;
    updatedAt: Date | null;
    fetchedTierFor: (placementId: string) => SizeTier | undefined;
    fetchedAppliedFor: (placementId: string) => string | undefined;
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
    const { answers, refused } = arrivals(state, retried, new Date(Date.now()));
    if (answers.size > 0 || refused.size > 0) {
      dispatch({ type: "arrived", answers, refused });
    }
  }, [state, retried]);

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
  const batchTierFor = batch.fetchedTierFor;
  const batchAppliedFor = batch.fetchedAppliedFor;
  const grow = useCallback(
    (request: WidgetQueryRequest) => {
      // A `stats` card's cells ask as declared whatever its settings, and a cell is not a card.
      if (request.cellKey !== undefined) return;
      dispatch({
        type: "grow",
        placementId: request.placementId,
        query: request.applied ?? request.query,
        ...(request.sized ? { tier: request.sized.tier } : {}),
        applied: appliedKey(request),
        batchFetchedAt: batchTierFor(request.placementId),
        batchApplied: batchAppliedFor(request.placementId),
      });
    },
    [batchTierFor, batchAppliedFor]
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

  const fetchingPlacementIds = useMemo(
    () => new Set(state.inFlight.keys()),
    [state.inFlight]
  );

  // A settled re-ask's answer is shown in place of the batch's, so its tier is the one shown; a
  // quiet re-ask still in flight shows the answer it had.
  const fetchedTierFor = useCallback(
    (placementId: string) => {
      const settled = state.settled.get(placementId);
      return settled ? settled.tier : batchTierFor(placementId);
    },
    [state.settled, batchTierFor]
  );

  return {
    slots,
    cellSlots,
    retry,
    updatedAtFor,
    grow,
    fetchingPlacementIds,
    fetchedTierFor,
  };
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
  const merged = {
    slots: { ...batch.slots },
    cellSlots: { ...batch.cellSlots },
  };
  for (const [placementId, answer] of state.settled) {
    // A card asked again because it grew keeps this answer until the new one is in, below.
    putAnswer(merged, placementId, answer, true);
  }
  for (const placementId of state.inFlight.keys()) {
    const answer = {
      slot: retried.slots[placementId],
      cells: retried.cellSlots[placementId],
    };
    // A quiet re-ask keeps what the card was showing until its answer is in; a pressed Retry
    // clears it, so the card draws its skeleton rather than the error it is retried from.
    putAnswer(merged, placementId, answer, !state.quiet.has(placementId));
  }
  return merged;
}

/**
 * Writes one card's answer over what the merged slots held for it. What the card showed is
 * cleared first when `clear` says so or when there is a new answer to show; otherwise it stays.
 */
function putAnswer(
  merged: { slots: Record<string, WidgetSlot>; cellSlots: CellSlots },
  placementId: string,
  answer: { slot?: WidgetSlot; cells?: Record<string, WidgetSlot> },
  clear: boolean
): void {
  if (clear || answer.slot || answer.cells) {
    delete merged.slots[placementId];
    delete merged.cellSlots[placementId];
  }
  if (answer.slot) merged.slots[placementId] = answer.slot;
  if (answer.cells) merged.cellSlots[placementId] = answer.cells;
}
