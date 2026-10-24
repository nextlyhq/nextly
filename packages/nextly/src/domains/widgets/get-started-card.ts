/**
 * Whether the Get started card is drawn, and the step answer it is drawn with,
 * decided by the layout read after the reader's stored row is read.
 *
 * The card has no condition, so its visibility follows permission alone and the
 * layout's visibility token stays stable as steps change. What changes is
 * whether it is DRAWN: a card in the arrangement that is neither removed nor
 * drawn is dormant, left out of what the reader is handed and carried in place
 * by their next save.
 *
 * @module domains/widgets/get-started-card
 */

import type { ConditionProbe } from "./condition-probe";
import { skippedSteps, withSkips } from "./get-started";
import {
  GET_STARTED_WIDGET_ID,
  type GetStartedAnswer,
} from "./get-started-steps";
import type { WidgetPlacement } from "./layout";

/** What the layout read says of the card. */
export interface GetStartedView {
  /** Whether the reader's card is drawn: false when removed, dormant or absent. */
  drawn: boolean;
  /**
   * The steps with the reader's skips applied, or `null` when nothing was
   * worked out: the card is not this reader's to see, not in their layout, or
   * removed and its answer not asked for.
   */
  answer: GetStartedAnswer | null;
}

const NOT_DRAWN: GetStartedView = { drawn: false, answer: null };

/** Whether a card's settings record that the reader acted on it. */
function actedOn(config: unknown): boolean {
  return (
    typeof config === "object" &&
    config !== null &&
    (config as { acted?: unknown }).acted === true
  );
}

/**
 * Whether a card with these settings is drawn for this answer: while a step is
 * waiting or not known, or setup could not be checked; and after that, only
 * for a reader who acted on it or skipped a step, who is shown "You're all
 * set" until they remove it. For anyone else a finished card goes quietly,
 * since every saved layout holds one whether its reader ever saw it or not.
 */
export function getStartedDrawn(
  answer: GetStartedAnswer,
  config: unknown
): boolean {
  return (
    answer.unknown ||
    answer.steps.some(
      step => step.status === "open" || step.status === "unknown"
    ) ||
    actedOn(config) ||
    skippedSteps(config).size > 0
  );
}

/** The reader's Get started card in an arrangement, if it holds one. */
export function getStartedPlacement(
  placements: readonly WidgetPlacement[]
): WidgetPlacement | undefined {
  return placements.find(
    placement => placement.widgetId === GET_STARTED_WIDGET_ID
  );
}

/**
 * The card's view for this reader.
 *
 * The steps are worked out only for a card that may be drawn, or for a removed
 * one whose answer the admin asked for as it restores the card, so a reader
 * who removed it pays for no step work on each dashboard load.
 */
export async function getStartedView(
  probe: ConditionProbe,
  card: WidgetPlacement | undefined,
  answerWhenRemoved: boolean
): Promise<GetStartedView> {
  if (card === undefined) return NOT_DRAWN;
  if (card.removed === true && !answerWhenRemoved) return NOT_DRAWN;
  const answer = withSkips(await probe.getStarted(), skippedSteps(card.config));
  return {
    drawn: card.removed !== true && getStartedDrawn(answer, card.config),
    answer,
  };
}

/**
 * `placements` without a dormant Get started card: one that is neither removed
 * nor drawn. A removed card stays, since it is listed under Removed.
 */
export function withoutDormantCard(
  placements: readonly WidgetPlacement[],
  drawn: (card: WidgetPlacement) => boolean
): WidgetPlacement[] {
  return placements.filter(
    placement =>
      placement.widgetId !== GET_STARTED_WIDGET_ID ||
      placement.removed === true ||
      drawn(placement)
  );
}
