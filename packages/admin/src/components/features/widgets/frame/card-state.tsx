"use client";

/**
 * The one description of what a card is showing, which the frame draws from.
 *
 * Every card's state arrives here, whoever decided it: the renderer maps a
 * batch answer to it (`WidgetRenderer`), and a core card whose own data says
 * more -- an answer with nothing in it, or one it cannot read -- reports it
 * with `FrameState`. The frame draws each state the same way on every card,
 * and a card's body is drawn only while it is `ready` or `refreshing`, so no
 * body draws a loading, empty, error or no-access state of its own.
 *
 * @module components/features/widgets/frame/card-state
 */

import type { WidgetResult, WidgetSlot } from "nextly/widget-result";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type JSX,
  type Provider,
} from "react";

import type { CardEmptyContent, SkeletonShape } from "./states";
import type { RowsLayout } from "./tier";

/** How the loading skeleton is laid out, when the card knows better than the frame. */
export interface SkeletonHint {
  shape?: SkeletonShape;
  /** How many rows a rows skeleton holds the place of. */
  rows?: number;
  layout?: RowsLayout;
}

/**
 * What the card shows.
 *
 * - `loading`: no answer has arrived yet; a skeleton shaped like the body holds its place.
 * - `refreshing`: the last answer stays on show, marked busy, while a new one is awaited.
 * - `ready`: the body.
 * - `empty`: the answer holds nothing; the card says what will appear, with at most one action.
 * - `error`: the card could not be drawn; the header stays, with Retry for this card alone.
 * - `no-access`: the source is forbidden, gone or kept off the dashboard, said one way for all.
 */
export type CardState =
  | { kind: "loading"; skeleton?: SkeletonHint }
  | { kind: "refreshing" }
  | { kind: "ready" }
  | { kind: "empty"; empty: CardEmptyContent }
  | { kind: "error"; message: string; retry?: () => void }
  | { kind: "no-access" };

/** A state a body reports in place of itself: never ready or refreshing, which it draws. */
export type ReportedState = Exclude<
  CardState,
  { kind: "ready" } | { kind: "refreshing" }
>;

/**
 * A component's batch answer, or the state to report while it has none to draw: loading while
 * the first one is on the way, "not available" when none is coming (a card never asked) or the
 * source is not the reader's, and an error with Retry for any other failure.
 *
 * The renderer draws a failed answer before a component is reached; read here too, so a body
 * drawn some other way still reports it rather than drawing from it. ONE reading, so every
 * component that draws from its slot reports each of these alike.
 */
export function readSlot(
  slot: WidgetSlot | undefined,
  options: {
    isFetching: boolean | undefined;
    skeleton: SkeletonHint;
    onRetry?: (() => void) | undefined;
  }
): { state: ReportedState } | { result: WidgetResult } {
  if (slot === undefined) {
    return {
      state:
        options.isFetching === true
          ? { kind: "loading", skeleton: options.skeleton }
          : { kind: "no-access" },
    };
  }
  if (slot.ok) return { result: slot.result };
  if (slot.code === "unavailable") return { state: { kind: "no-access" } };
  return {
    state: {
      kind: "error",
      message: slot.error,
      ...(options.onRetry ? { retry: options.onRetry } : {}),
    },
  };
}

/** Whether the card's body is on show in this state. */
export function showsBody(state: CardState): boolean {
  return state.kind === "ready" || state.kind === "refreshing";
}

/** What a body reports, and how the frame hears it. */
type Report = (state: CardState | null) => void;

const CardStateReport = createContext<Report | null>(null);

/** Provided by the frame, so a body inside it can report a state. */
export const CardStateReportProvider: Provider<Report | null> =
  CardStateReport.Provider;

/**
 * A body's report that the card is not ready: what its own data says, which
 * the frame then draws in its place. Renders nothing itself.
 *
 * Reported before paint, so the reader never sees the body's first render
 * standing in for the state, and withdrawn on unmount, so the next answer
 * starts from the renderer's own state again.
 */
export function FrameState({
  state,
}: {
  state: ReportedState;
}): JSX.Element | null {
  const report = useContext(CardStateReport);
  // Reported again only when what the state SAYS changes, not on every new
  // object a body builds for it, which would re-render the frame each time.
  // The latest object rides in a ref, so the report is never a stale one.
  const latest = useRef(state);
  latest.current = state;
  const key = stateKey(state);
  useLayoutEffect(() => {
    report?.(withCurrentRetry(latest.current, latest));
    return () => report?.(null);
  }, [report, key]);
  return null;
}

/**
 * A reported error whose Retry always calls the body's CURRENT callback. The report is kept until
 * what the state says changes, so a callback captured with it would go stale when the body's
 * settings change with the same message; reading it through the ref keeps Retry asking the card's
 * question as it is now.
 */
function withCurrentRetry(
  state: ReportedState,
  latest: { readonly current: ReportedState }
): ReportedState {
  if (state.kind !== "error" || state.retry === undefined) return state;
  return {
    ...state,
    retry: () => {
      const now = latest.current;
      if (now.kind === "error") now.retry?.();
    },
  };
}

/** What makes two reports of a state the same report. */
function stateKey(state: CardState): string {
  switch (state.kind) {
    case "loading":
      return JSON.stringify(["loading", state.skeleton ?? null]);
    case "empty":
      return JSON.stringify(["empty", state.empty]);
    case "error":
      return JSON.stringify([
        "error",
        state.message,
        state.retry !== undefined,
      ]);
    default:
      return state.kind;
  }
}
