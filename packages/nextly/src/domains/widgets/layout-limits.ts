/**
 * The dashboard layout's limits that a browser needs to know.
 *
 * Its own module, with NO imports, for the reason `batch-limit.ts` is: the
 * admin reads these through `nextly/config`, which is published as safe for a
 * browser, and `layout.ts`, where they were declared, imports `node:crypto`
 * for its visibility token. Reached through it, a client bundle would carry a
 * Node built-in it can never load. Declared here, the server and the browser
 * still read ONE value each, so the editor and the endpoint cannot disagree
 * about what a layout may hold.
 *
 * @module domains/widgets/layout-limits
 */

/**
 * How many placements one layout write may hold. `layout.ts` says why there
 * is a ceiling at all, beside the payload's byte limit it shares a reason with.
 */
export const MAX_PLACEMENTS = 200;

/**
 * Whether a value is text with something in it: what a placement's id must
 * be. One reading, so the site config's check accepts exactly the card ids
 * the layout endpoint accepts on a write.
 */
export function isUsableText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
