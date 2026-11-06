/**
 * Which of a reader's cards that hide while empty answer empty for them now,
 * decided when their layout is read so the dashboard's first paint is final;
 * and which hide by their own answer instead, since the layout read cannot
 * answer them.
 *
 * A card that hides while empty and is drawn before its answer arrives takes
 * its place, then leaves it, and every card after it moves up; one held back
 * until its answer says it has something moves them down instead. Either is a
 * dashboard moving under its reader. The layout read asks each such card of a
 * declared widget for its answer first, so the admin draws it, or leaves it
 * out, from the start. A widget of the other channels (`registerWidget`,
 * `contributes.admin.widgets`) has no answer core can give on the server: its
 * card leaves the dashboard when its own answer, drawn in the browser, is
 * empty.
 *
 * Loaded lazily by the layout endpoint, as `default-cards-shown` is: it
 * reaches the card endpoint, which itself reads the layout to know what a
 * caller was handed.
 *
 * @module api/cards-answered-empty
 */

import type { AuthContext } from "../auth/middleware";
import { createBatchScope } from "../domains/widgets/batch-scope";
import type { CanonicalWidget } from "../domains/widgets/canonical";
import { refreshContentSources } from "../domains/widgets/content-sources";
import { declaredWidget } from "../domains/widgets/declaration/declared-widgets";
import type { WidgetPlacement } from "../domains/widgets/layout";
import { handOverReadAhead } from "../domains/widgets/read-ahead-handover";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import { cardAnswersEmpty, type CardBatch } from "./widget-cards";
import { cardBatchFor } from "./widget-query";

const NONE: readonly string[] = [];

/**
 * How a widget's cards leave the dashboard while empty, by its canonical
 * summary's `hidesWhenEmpty`, whichever channel declared it: `"ahead"`, judged
 * by the layout read, for a declared widget, whose answer core gives on the
 * server; `"own-answer"`, by its own answer as the admin draws it, for any
 * other; `undefined` for a widget that does not hide while empty. The one rule
 * for which applies: the layout read's candidates and the admin's list both
 * come from it.
 */
function hideRule(
  widget: CanonicalWidget | undefined
): "ahead" | "own-answer" | undefined {
  if (widget?.hidesWhenEmpty !== true) return undefined;
  return declaredWidget(widget.id) === undefined ? "own-answer" : "ahead";
}

/**
 * The ids of the widgets among `widgets` whose cards leave the dashboard when
 * their own answer is empty (`hideRule`): those that hide while empty and that
 * the layout read cannot answer. In the widgets' order.
 */
export function hiddenWhenAnswerEmpty(
  widgets: readonly CanonicalWidget[]
): readonly string[] {
  return widgets
    .filter(widget => hideRule(widget) === "own-answer")
    .map(widget => widget.id);
}

/** What the layout read is judging its cards with, beside the reader and their cards. */
export interface AheadOfTheBatch {
  /** The widgets the reader may see, as the layout read resolved them. */
  widgets: readonly CanonicalWidget[];
  /**
   * The dashboard's width as the admin measured it when it asked, which each
   * card's tier is read from (`cardAnswersEmpty`).
   */
  dashboardWidth: number;
  /** The request's own signal: the read is given up with it. */
  signal: AbortSignal;
  /** The dashboard load the read is ahead of (`readAheadToken`). */
  readAheadToken: string;
}

/**
 * The ids of the cards among `placements`, as handed to this reader, whose
 * widget is judged ahead (`hideRule`) and whose answer is empty for them
 * (`cardAnswersEmpty`), in the placements' order. Every other card, a card
 * that failed or ran out of time included, is placed. A card the reader
 * removed is not asked: nothing draws it.
 *
 * Every card is asked at once, with one instant and one share scope for the
 * read, under the request's `signal`, at the tier it is drawn at on a
 * dashboard `dashboardWidth` wide, as read ahead for the dashboard load
 * `readAheadToken` names: the batch that load asks, sending the token back,
 * may be handed what was read here, and no other ask is. The load is handed
 * over (`handOverReadAhead`) once every card has answered, the slowest
 * included, when the layout read's answer is ready to return: what was read
 * here waits for the batch from then, so a card that answered early does not
 * see its answer expire while a slower one is still being judged.
 */
export async function cardsAnsweredEmpty(
  auth: AuthContext,
  reader: ReadCaller,
  placements: readonly WidgetPlacement[],
  ahead: AheadOfTheBatch
): Promise<readonly string[]> {
  const byId = new Map(ahead.widgets.map(widget => [widget.id, widget]));
  const asked = placements.flatMap(placement => {
    // A card the reader removed is kept only so it can be put back: it is
    // never drawn or asked by the batch, so its `load` is not run here either.
    if (placement.removed) return [];
    const declared = declaredWidget(placement.widgetId);
    return declared !== undefined &&
      hideRule(byId.get(placement.widgetId)) === "ahead"
      ? [{ placement, declared }]
      : [];
  });
  if (asked.length === 0) return NONE;
  // As a batch does before it answers a card: a widget's `access` by the
  // collections it reads, and its `shows`, read the content sources.
  await refreshContentSources();
  // Ahead of the dashboard's own batch, which asks these cards again.
  const batch: CardBatch = {
    ...cardBatchFor(auth, reader),
    readAhead: { side: "ahead", token: ahead.readAheadToken },
  };
  const scope = createBatchScope();
  const now = new Date();
  // The load is handed over once every card has answered, however the judging
  // ended: a read that failed is never answered, so no batch names its load,
  // and handing it over lets what was read for it close and be dropped.
  const empty = await Promise.all(
    asked.map(({ placement, declared }) =>
      cardAnswersEmpty(
        declared,
        placement,
        batch,
        { signal: ahead.signal, now, scope: scope.forOwner(declared.owner) },
        ahead.dashboardWidth
      )
    )
  ).finally(() => handOverReadAhead(ahead.readAheadToken));
  return asked
    .filter((_, index) => empty[index])
    .map(({ placement }) => placement.id);
}
