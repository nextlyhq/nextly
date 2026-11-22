/**
 * What the header & footer set counts route answers, shared by the route and
 * the editor panels that show the numbers.
 *
 * Its own module, free of server imports, so an admin bundle takes the shape
 * without the route's reads.
 *
 * @module layout-counts-contract
 */

/** Where the set counts are read, under this plugin's own namespace. */
export const LAYOUT_COUNTS_ROUTE_PATH = "/layouts/counts";

/** How many pages use one set. */
export interface LayoutPageCount {
  /** The pages counted. Never more than the truth. */
  readonly pages: number;
  /**
   * Whether `pages` is a floor: a bounded read stopped before the end, so
   * there may be more. Said to an author as "at least N".
   */
  readonly floor: boolean;
}

/**
 * Each set the caller may read, by id, with its count. A set the caller may
 * not read is absent: its id is not theirs to learn. Nothing about the pages
 * counted is answered beyond the number.
 */
export type LayoutPageCountsResponse = Readonly<
  Record<string, LayoutPageCount>
>;
