/**
 * What the pattern library route answers, named where both ends can read it.
 *
 * IMPORT-FREE, deliberately, and that is the whole reason this file is separate
 * from the route that implements it. The route reaches the collection through
 * `nextly/config`, which pulls the Direct API — server-only, and it says so at
 * load time. A browser module importing the route for one path constant brings
 * that with it: measured, importing it from the admin client took eleven test
 * files out at collection with "Direct API permissions module loaded in a
 * browser context".
 *
 * The same reason `nextly/config` shares `pluginAdminSlug` and
 * `pluginRouteFullPath`: a value both a server and a browser must agree on has
 * to live somewhere neither one's runtime is required to load.
 *
 * @module library-contract
 */

/** Where the panel finds the library, under this plugin's own namespace. */
export const LIBRARY_ROUTE_PATH = "/library";

/**
 * One pattern, as the panel needs it.
 *
 * The DOCUMENT travels, which is what makes this bigger than an index. The
 * palette runs the planner's whole preflight over each pattern before offering
 * it — a stored row can be the wrong kind, hold no nodes, or nest in a way the
 * rules no longer allow — so a tile exists only for a pattern the planner would
 * actually place. A metadata-only index cannot answer that, and a panel that
 * guessed would offer tiles that accept a click and then refuse.
 */
export interface LibraryPattern {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly category?: string;
  /** The author's own search terms, as stored — one string, or unset. */
  readonly keywords?: string | null;
  /** How much of a page this covers; the panel offers `page` differently. */
  readonly granularity?: string;
  /** The stored pattern document, or absent as a stored row's may be. */
  readonly content?: unknown;
}

/** What one library read answers. */
export interface LibraryResponse {
  readonly items: readonly LibraryPattern[];
  readonly meta: {
    /** How many were returned. */
    readonly count: number;
    /** Whether the ceiling stopped the read before the collection ended. */
    readonly truncated: boolean;
  };
}
