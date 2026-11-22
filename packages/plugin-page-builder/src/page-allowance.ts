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

/**
 * The site's page data limit as the admin's client config carries it: a
 * whole number from 0, `null` for no limit, or `undefined` (the default)
 * for anything else, as the plugin sends nothing else. The one reading of
 * it, so the editor's meter, the canvas's draw and the canvas's bindings
 * read count against the same limit.
 */
export function readPageDataLimit(
  clientConfig: Readonly<Record<string, unknown>> | undefined
): number | undefined {
  const sent = clientConfig?.maxQueries;
  if (sent === null) return Number.POSITIVE_INFINITY;
  return typeof sent === "number" && Number.isInteger(sent) && sent >= 0
    ? sent
    : undefined;
}

/** An allowance as a route reads it: `null` is no limit. */
export function allowanceFromWire(
  sent: number | null | undefined
): number | undefined {
  return sent === null ? Number.POSITIVE_INFINITY : sent;
}
