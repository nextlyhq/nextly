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
 * How many columns a dashboard has when nobody has chosen.
 *
 * Three rather than two or four: it is the widest count that still leaves a
 * card readable at the admin's content width, and folding 3 -> 2 -> 1 by
 * breakpoint keeps a placement's column derivable at every width.
 */
export const DEFAULT_COLUMN_COUNT = 3;

/** The column counts a dashboard may have. */
export const COLUMN_COUNTS = [2, 3, 4] as const;

/** One of the column counts a dashboard may have. */
export type ColumnCount = (typeof COLUMN_COUNTS)[number];

/**
 * How many placements one layout write may hold. `layout.ts` says why there
 * is a ceiling at all, beside the payload's byte limit it shares a reason with.
 */
export const MAX_PLACEMENTS = 200;
