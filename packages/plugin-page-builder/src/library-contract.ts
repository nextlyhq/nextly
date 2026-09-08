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
import type { SavedPattern } from "@nextlyhq/builder";

/**
 * The name this plugin registers under, which is also how its routes are
 * addressed.
 *
 * ONE literal, consumed by the plugin definition and by the editor that calls
 * its route. Two spellings of it is a package rename that leaves the server
 * mounted under the new name while every editor keeps asking for the old path —
 * and the failure is silent, because a request to a path nothing serves answers
 * with nothing and reads as a site that has saved no patterns.
 */
export const PAGE_BUILDER_PLUGIN_NAME = "@nextlyhq/plugin-page-builder";

/** Where the panel finds the library, under this plugin's own namespace. */
export const LIBRARY_ROUTE_PATH = "/library";

/**
 * One pattern, as the panel needs it.
 *
 * DERIVED from `SavedPattern` — the shape the panel actually reads — rather
 * than described again here. The two were described separately once, and they
 * disagreed about one field name: the wire carried `content`, which is what the
 * collection stores it under, while `patternEntriesFrom` reads `document` and
 * SKIPS a pattern that has none. Every pattern on every site was dropped, in
 * silence, and the tier looked wired and empty. Extending the published type
 * makes that a compile error rather than a thing to notice.
 *
 * The DOCUMENT travels, which is what makes this bigger than an index. The
 * palette runs the planner's whole preflight over each pattern before offering
 * it — a stored row can be the wrong kind, hold no nodes, or nest in a way the
 * rules no longer allow — so a tile exists only for a pattern the planner would
 * actually place. A metadata-only index cannot answer that.
 */
export interface LibraryPattern extends SavedPattern {
  /**
   * How much of a page this covers.
   *
   * Known to the library and absent from `SavedPattern`, deliberately: a
   * full-page pattern is a way to START a page rather than something to insert
   * into one, so the insert list is not where it belongs. Carried here so the
   * surface that offers it can tell them apart.
   */
  readonly granularity?: string;
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
