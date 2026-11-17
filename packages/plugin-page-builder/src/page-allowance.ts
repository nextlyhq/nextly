/**
 * The reads a page has left, as they cross the wire between the editor's
 * count and the routes it reads through.
 *
 * A site that sets no page data limit (`pageBuilder({ maxQueries:
 * Infinity })`) counts under an unlimited allowance, and JSON has no
 * `Infinity`: it would arrive as `null` and be refused. So `null` is the
 * wire's spelling for no limit, said on purpose, and a route reads it back
 * as `Infinity`. Absent still means the default allowance.
 *
 * @module page-allowance
 */

/**
 * The most reads a route may be asked to allow: far past any page's need,
 * and the most a site's limit may be, short of none at all, so every limit
 * a site may set can be asked for.
 */
export const MOST_PAGE_READS = 100_000;

/** An allowance as the editor sends it: a whole count, `null` for none. */
export function allowanceToWire(
  allowance: number | undefined
): number | null | undefined {
  if (allowance === undefined) return undefined;
  if (!Number.isFinite(allowance)) return allowance > 0 ? null : 0;
  return Math.max(0, Math.floor(allowance));
}

/** An allowance as a route reads it: `null` is no limit. */
export function allowanceFromWire(
  sent: number | null | undefined
): number | undefined {
  return sent === null ? Number.POSITIVE_INFINITY : sent;
}
