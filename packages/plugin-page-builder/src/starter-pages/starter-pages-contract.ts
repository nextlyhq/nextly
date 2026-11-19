/**
 * What the starter pages read answers, named where both ends can read it:
 * the starters the site offers now, for the empty page's "or start from a
 * page" row. The New page dialog reads the same list with what a new page
 * would get (`NewPageFacts.starters`).
 *
 * FREE OF SERVER IMPORTS, so the editor can name the route without the
 * server's registry.
 *
 * @module starter-pages/starter-pages-contract
 */
import type { PaginationMeta } from "@nextlyhq/plugin-sdk";

import type { NewPageStarter } from "../pages-write-contract";

/** @experimental Where the starter pages the site offers now are read. */
export const STARTER_PAGES_ROUTE_PATH = "/starter-pages";

/** @experimental The starter pages read's answer: the list envelope. */
export interface StarterPagesResponse {
  readonly items: readonly NewPageStarter[];
  readonly meta: PaginationMeta;
}
