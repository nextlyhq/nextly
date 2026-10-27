/**
 * The query a card asks at its size, and whether a change of size asks again.
 *
 * A card's first query is asked before the card can measure itself, from its predicted tier and
 * its height in grid rows, and asks for no more than that size draws. What a limit counts
 * depends on the query's op, so
 * the op decides how it is sized. A list's limit counts rows, and is sized. A breakdown's counts
 * groups, and is not: the chart orders its groups (ties by label) before it cuts them to its
 * tier, and a cut on the server breaks ties by stored value instead, so a group the chart's own
 * order keeps could be gone before the chart sees it. Any other op's limit (an over-time query's
 * window of intervals) is not the tier's to change.
 *
 * @module components/features/widgets/tier-query
 */

import type { SizeTier } from "@nextlyhq/ui/format";
import type { ListDensity } from "nextly/config";

import type { SizedAt } from "@admin/hooks/queries/useWidgetQueries";

import { rowsDrawn } from "./frame/tier";

/**
 * The groups a breakdown draws at each tier: the three, five or eight with the most entries. The
 * chart's cut, not the query's: see the module note.
 */
export const GROUPS_DRAWN: Readonly<Record<SizeTier, number>> = Object.freeze({
  small: 3,
  medium: 5,
  large: 8,
});

/** The part of a widget query its tier sizes. */
interface SizedQuery {
  op: string;
  limit?: number;
}

/**
 * What a query draws at `size`, in its own unit, or `undefined` for one the size does not size.
 * A list's rows are the whole rows its body holds, from the card's height at its density.
 */
function drawnAt(query: SizedQuery, size: SizedAt): number | undefined {
  if (query.op !== "list") return undefined;
  return rowsDrawn(
    { tier: size.tier, h: size.h },
    query.limit,
    size.density ?? "default"
  );
}

/**
 * `query`, asked for what a card of `tier` draws at `density`, `h` grid rows tall where it has a
 * height.
 *
 * A list asks one row more than it draws, because a source that does not count its rows answers
 * no total, and the extra row is how the card learns that more exist. Any other query, a breakdown's included, is asked
 * as declared. Returns the query it was given when the tier changes nothing, so the batch's
 * memoisation keeps its identity.
 */
export function queryForTier<Q extends SizedQuery>(
  query: Q,
  tier: SizeTier,
  density: ListDensity = "default",
  h?: number
): Q {
  const drawn = drawnAt(query, {
    tier,
    density,
    ...(h === undefined ? {} : { h }),
  });
  if (drawn === undefined) return query;
  // Only a list is sized, and it asks the one row more that says more exist.
  const limit = drawn + 1;
  return limit === query.limit ? query : { ...query, limit };
}

/**
 * Whether a card whose answer was fetched at `fetchedAt` must ask again now that it is `now`.
 *
 * Only when it now draws more than was fetched: it grew taller, crossed into a tier counted with
 * more room, or became compact. An answer fetched for a larger card still serves a smaller one,
 * which draws a prefix of it, so a card that shrinks asks nothing.
 */
export function asksAgainAt(
  query: SizedQuery,
  fetchedAt: SizedAt,
  now: SizedAt
): boolean {
  const fetched = drawnAt(query, fetchedAt);
  const drawn = drawnAt(query, now);
  return fetched !== undefined && drawn !== undefined && drawn > fetched;
}
