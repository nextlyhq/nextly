/**
 * What the loop collections route answers, named where both ends can read it.
 *
 * A collection loop stores the slug of the collection it repeats over and a
 * sort string naming its fields. The inspector offers both as menus, which
 * need the collections the author may read and, for each, the fields its
 * entries can be ordered by. This module is what the route and the admin
 * client agree on.
 *
 * FREE OF RUNTIME IMPORTS, for the reason `library-contract.ts` gives: the
 * route reaches the registry through the server, and a browser module
 * importing the route for one path constant would bring it along. Types are
 * the exception, since they are erased before a browser sees them.
 *
 * @module loop-collections-contract
 */
import type { PaginationMeta } from "nextly";

/** Where the inspector lists a loop's collections, under this plugin's namespace. */
export const LOOP_COLLECTIONS_ROUTE_PATH = "/loop-collections";

/** One field a collection's entries can be ordered by. */
export interface LoopSortFieldItem {
  /** The key a sort stores: the field's name. */
  readonly name: string;
  /** What the author calls it: its label, or its name in words. */
  readonly label: string;
  /** Whether it holds a date, which the sort menu lists first. */
  readonly date: boolean;
}

/** One collection a loop can repeat over. */
export interface LoopCollectionItem {
  readonly slug: string;
  /** Its plural name where it has one, else its name, else its slug. */
  readonly label: string;
  /** Its sortable fields, in the collection's order, then its timestamps. */
  readonly sortFields: readonly LoopSortFieldItem[];
}

/**
 * What the route answers: the canonical list envelope, `{ items, meta }`,
 * every collection on one page.
 */
export interface LoopCollectionsResponse {
  readonly items: readonly LoopCollectionItem[];
  readonly meta: PaginationMeta;
}
