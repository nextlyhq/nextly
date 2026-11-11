/**
 * Chains of redirects: every redirect is stored to the end of its chain, so a
 * visitor takes one hop, and one that would come back to where it started is
 * refused.
 *
 * Only exact addresses on this site are followed. A pattern's To address is
 * matched against each request rather than stored, and an address on another
 * site is not this site's to follow.
 *
 * @module redirects/chains
 */
import { pathOf } from "./addresses";

/**
 * `to` with the query of `from` where `to` names none of its own: what a
 * visitor sent on from `from` arrives at.
 */
export function withQueryOf(to: string, from: string): string {
  if (to.includes("?")) return to;
  const query = from.split("#", 1)[0]?.split("?")[1];
  return query === undefined || query === "" ? to : `${to}?${query}`;
}

/** Where a chain ends, and every address it passes on the way. */
export type ChainEnd = { final: string; path: string[] } | { error: string };

/** How far a chain is followed before it is taken to be a loop. */
const LONGEST_CHAIN = 64;

/**
 * Follow `to`, the To address of a redirect from `from`, through the exact
 * redirects `next` reads one hop at a time, to where it ends. Refused where
 * it comes back to `from`, or runs into a loop of its own.
 */
export async function followChain(
  from: string,
  to: string,
  next: (path: string) => Promise<string | null>
): Promise<ChainEnd> {
  const path = [to];
  const seen = new Set([pathOf(to)]);
  let current = to;
  while (current.startsWith("/") && !current.endsWith("/*")) {
    // Requests are matched by their path, so `/a?ref=1` reaches `/a`.
    if (pathOf(current) === from) {
      return { error: `That makes a loop: ${[from, ...path].join(" → ")}.` };
    }
    const hop = await next(pathOf(current));
    if (hop === null) break;
    // A hop to another site ends the chain there: its path is that site's,
    // never one of this site's addresses.
    if (!hop.startsWith("/")) {
      const carried = withQueryOf(hop, current);
      path.push(carried);
      current = carried;
      break;
    }
    if (pathOf(hop) === from) {
      return {
        error: `That makes a loop: ${[from, ...path, hop].join(" → ")}.`,
      };
    }
    if (seen.has(pathOf(hop)) || path.length >= LONGEST_CHAIN) {
      return {
        error: `${to} is already part of a loop. Fix that redirect first.`,
      };
    }
    seen.add(pathOf(hop));
    // A visitor's query goes on with them where the next To address names
    // none, so the one hop keeps the query the chain would have carried.
    const carried = withQueryOf(hop, current);
    path.push(carried);
    current = carried;
  }
  return { final: current, path };
}
