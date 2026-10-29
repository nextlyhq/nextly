/**
 * Which of a reader's cards that hide while empty answer empty for them now,
 * decided when their layout is read so the dashboard's first paint is final.
 *
 * A card that hides while empty and is drawn before its answer arrives takes
 * its place, then leaves it, and every card after it moves up; one held back
 * until its answer says it has something moves them down instead. Either is a
 * dashboard moving under its reader. The layout read asks each such card for
 * its answer first, so the admin draws it, or leaves it out, from the start.
 *
 * Loaded lazily by the layout endpoint, as `default-cards-shown` is: it
 * reaches the card endpoint, which itself reads the layout to know what a
 * caller was handed.
 *
 * @module api/cards-answered-empty
 */

import type { AuthContext } from "../auth/middleware";
import { createBatchScope } from "../domains/widgets/batch-scope";
import { refreshContentSources } from "../domains/widgets/content-sources";
import { declaredWidget } from "../domains/widgets/declaration/declared-widgets";
import type { WidgetPlacement } from "../domains/widgets/layout";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import { cardAnswersEmpty } from "./widget-cards";
import { cardBatchFor } from "./widget-query";

const NONE: readonly string[] = [];

/**
 * The ids of the cards among `placements`, as handed to this reader, whose
 * declared widget hides while empty and whose answer is empty for them
 * (`cardAnswersEmpty`), in the placements' order. Every other card, a card
 * that failed or ran out of time included, is placed.
 *
 * Every card is asked at once, with one instant and one share scope for the
 * read, under the request's `signal`.
 */
export async function cardsAnsweredEmpty(
  auth: AuthContext,
  reader: ReadCaller,
  placements: readonly WidgetPlacement[],
  signal: AbortSignal
): Promise<readonly string[]> {
  const asked = placements.flatMap(placement => {
    const declared = declaredWidget(placement.widgetId);
    return declared?.declaration.hidesWhenEmpty === true
      ? [{ placement, declared }]
      : [];
  });
  if (asked.length === 0) return NONE;
  // As a batch does before it answers a card: a widget's `access` by the
  // collections it reads, and its `shows`, read the content sources.
  await refreshContentSources();
  // Ahead of the dashboard's own batch, which asks these cards again.
  const batch = { ...cardBatchFor(auth, reader), readAhead: true };
  const scope = createBatchScope();
  const now = new Date();
  const empty = await Promise.all(
    asked.map(({ placement, declared }) =>
      cardAnswersEmpty(declared, placement, batch, {
        signal,
        now,
        scope: scope.forOwner(declared.owner),
      })
    )
  );
  return asked
    .filter((_, index) => empty[index])
    .map(({ placement }) => placement.id);
}
