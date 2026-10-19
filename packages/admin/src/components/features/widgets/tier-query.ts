/**
 * The query a card asks at its tier, and whether a change of tier asks again.
 *
 * A card's first query is asked before the card can measure itself, from its predicted tier,
 * and asks for no more than that tier draws. What a limit counts depends on the query's op, so
 * the op decides how it is sized: a list's limit counts rows, a breakdown's counts groups, and
 * any other op's limit (an over-time query's window of intervals) is not the tier's to change.
 *
 * @module components/features/widgets/tier-query
 */

import type { SizeTier } from "@nextlyhq/ui/format";
import { effectiveWidgetLimit } from "nextly/config";

import { rowsDrawn } from "./frame/tier";

/** The groups a breakdown draws at each tier: the three, five or eight with the most entries. */
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

/** What a query draws at `tier`, in its own unit, or `undefined` for one the tier does not size. */
function drawnAt(query: SizedQuery, tier: SizeTier): number | undefined {
  if (query.op === "list") return rowsDrawn(tier, query.limit);
  if (query.op === "groupBy") {
    return Math.min(effectiveWidgetLimit(query.limit), GROUPS_DRAWN[tier]);
  }
  return undefined;
}

/**
 * `query`, asked for what a card of `tier` draws.
 *
 * A list asks one row more than it draws, because a list answer carries no total and the extra
 * row is how the card learns that more exist. A breakdown asks exactly the groups it draws: a
 * grouped answer says itself, as `truncated`, when groups were left out. Returns the query it
 * was given when the tier changes nothing, so the batch's memoisation keeps its identity.
 */
export function queryForTier<Q extends SizedQuery>(
  query: Q,
  tier: SizeTier
): Q {
  const drawn = drawnAt(query, tier);
  if (drawn === undefined) return query;
  const limit = query.op === "list" ? drawn + 1 : drawn;
  return limit === query.limit ? query : { ...query, limit };
}

/**
 * Whether a card whose answer was fetched at `fetchedAt` must ask again now that it is `tier`.
 *
 * Only when it now draws more than was fetched. An answer fetched for a wider card still serves
 * a narrower one, which draws a prefix of it, so a tier that shrinks asks nothing.
 */
export function asksAgainAt(
  query: SizedQuery,
  fetchedAt: SizeTier,
  tier: SizeTier
): boolean {
  const fetched = drawnAt(query, fetchedAt);
  const drawn = drawnAt(query, tier);
  return fetched !== undefined && drawn !== undefined && drawn > fetched;
}
