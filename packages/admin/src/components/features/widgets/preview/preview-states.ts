/**
 * Which states the preview page draws each card in, and the answer each is
 * drawn from.
 *
 * 🔴 Every state is drawn by the dashboard's own path: the renderer handed a
 * slot, as the batch would hand it one. Nothing here draws a state itself, so
 * a preview cannot look unlike the card it previews.
 *
 * Whether a card actually shows a state is not decided here either: it is the
 * outcome the dashboard itself resolves for that slot (`resolveWidgetOutcome`),
 * compared with the state asked for. A card that asks for no data (a text or
 * actions card) never loads or fails, and a card that draws itself (core's own
 * sections) draws its loading state with its own data; for both the outcome
 * differs from the state asked, and the page says so in the card's place
 * rather than mounting a component that would read live data.
 *
 * @module components/features/widgets/preview/preview-states
 */

import type { WidgetResult, WidgetSlot } from "nextly/widget-result";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import type { CellSlotLookup } from "../archetypes/types";
import { resolveWidgetOutcome, type WidgetOutcome } from "../outcome";

/** A frame state the page draws every card in, beside its ready cases. */
export type FrameStateName = "loading" | "empty" | "error" | "unavailable";

/** Every state the page draws, in the order it draws them. */
export type PreviewStateName = "ready" | FrameStateName;

/** The frame states, in the order the page draws them after the ready cases. */
export const FRAME_STATES: readonly FrameStateName[] = [
  "loading",
  "empty",
  "error",
  "unavailable",
];

/** What the page calls each state. */
export const PREVIEW_STATE_LABELS: Readonly<Record<PreviewStateName, string>> =
  {
    ready: "Ready",
    loading: "Loading",
    empty: "Empty",
    error: "Error",
    unavailable: "Not available",
  };

/**
 * The sentence a card that failed is sent: the one a failure that is not the
 * reader's to know about carries (`GENERIC_SLOT_ERROR` on the server).
 */
const FAILED_MESSAGE = "An unexpected error occurred.";

/** What a card asks with: its own slot, and each cell's for a card of several. */
export interface PreviewAnswer {
  slot: WidgetSlot | undefined;
  slotFor: CellSlotLookup;
}

/** One answer for the card and for every cell of it. */
function answerOf(slot: WidgetSlot | undefined): PreviewAnswer {
  return { slot, slotFor: () => slot };
}

/** The answer a case's ready state is drawn from: its data, as a real answer is carried. */
export function readyAnswer(result: WidgetResult): PreviewAnswer {
  return answerOf({ ok: true, result });
}

/** The answer each frame state is drawn from. */
export function frameAnswer(state: FrameStateName): PreviewAnswer {
  switch (state) {
    case "loading":
      // No answer yet, as before the batch has answered.
      return answerOf(undefined);
    case "empty":
      // The server's empty verdict, which the frame draws with the widget's
      // own words whatever the answer beside it holds.
      return answerOf({
        ok: true,
        result: { op: "data", data: null },
        empty: true,
      });
    case "error":
      return answerOf({ ok: false, error: FAILED_MESSAGE });
    case "unavailable":
      return answerOf({
        ok: false,
        error: "Not available.",
        code: "unavailable",
      });
  }
}

/** The outcomes that are each state, as the dashboard resolves them. */
const OUTCOMES: Readonly<
  Record<PreviewStateName, readonly WidgetOutcome["state"][]>
> = {
  // A case whose data its view reads as empty is drawn as the card would draw
  // that answer: its empty state, which is the truth about that case.
  ready: ["ready", "answered", "empty"],
  loading: ["loading"],
  empty: ["empty"],
  error: ["failed"],
  unavailable: ["unavailable"],
};

/**
 * Whether this card shows `state` when handed `answer`: the dashboard's own
 * outcome for it, compared with the state asked for.
 */
export function cardShows(
  definition: DashboardWidget,
  state: PreviewStateName,
  answer: PreviewAnswer
): boolean {
  const outcome = resolveWidgetOutcome(definition, answer.slot, answer.slotFor);
  return OUTCOMES[state].includes(outcome.state);
}
