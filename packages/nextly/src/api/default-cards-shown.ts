/**
 * Which cards of the default dashboard a person would not be shown, by each
 * declared card's own rules: its `access` and its `shows`, judged as that
 * person, without running its `load` (`cardIsShownTo`).
 *
 * The default is the same for everyone (`default-layout.ts`); what varies per
 * person is only what they may see. The layout's audience removes the cards of
 * widgets they may not see; this removes, from what is left, the declared
 * cards whose own rules say no, so a card is left out of their default rather
 * than drawn and then answered "not shown".
 *
 * Loaded lazily by the layout endpoint: it reaches the card endpoint's
 * judgement, which itself reads the layout to know what a caller was handed.
 *
 * @module api/default-cards-shown
 */

import type { AuthContext } from "../auth/middleware";
import { createBatchScope } from "../domains/widgets/batch-scope";
import { refreshContentSources } from "../domains/widgets/collection-widgets";
import { declaredWidget } from "../domains/widgets/declaration/declared-widgets";
import type { WidgetPlacement } from "../domains/widgets/layout";
import type { ReadCaller } from "../services/dashboard/readable-resources";

import { cardIsShownTo } from "./widget-cards";
import { cardBatchFor } from "./widget-query";

const NONE: ReadonlySet<string> = new Set();

/**
 * The ids of the cards among `placements`, a default as handed to this person,
 * that its declared widget's own rules would not show them. Only declared
 * cards are asked: a widget of any other shape has no rule of its own, and
 * the audience has already judged its permission.
 *
 * Every card is judged at once, with one instant and one share scope for the
 * read, under the request's `signal`; a card whose judgement throws or runs
 * out of time is not shown (`cardIsShownTo`).
 */
export async function defaultCardsNotShown(
  auth: AuthContext,
  reader: ReadCaller,
  placements: readonly WidgetPlacement[],
  signal: AbortSignal
): Promise<ReadonlySet<string>> {
  const asked = placements.flatMap(placement => {
    const declared = declaredWidget(placement.widgetId);
    return declared === undefined ? [] : [{ placement, declared }];
  });
  if (asked.length === 0) return NONE;
  // As a batch does before it answers a card: a widget's `access` by the
  // collections it reads, and its `shows`, read the content sources.
  await refreshContentSources();
  const batch = cardBatchFor(auth, reader);
  const scope = createBatchScope();
  const now = new Date();
  const shown = await Promise.all(
    asked.map(({ placement, declared }) =>
      cardIsShownTo(declared, placement, batch, {
        signal,
        now,
        scope: scope.forOwner(declared.owner),
      })
    )
  );
  return new Set(
    asked
      .filter((_, index) => !shown[index])
      .map(({ placement }) => placement.id)
  );
}
