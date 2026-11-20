/**
 * What the header & footer set writes route answers and is sent, shared by
 * the route and the builder's Pages panel that renames and duplicates sets.
 *
 * Its own module, free of server imports, so an admin bundle takes the shape
 * without the route's writes.
 *
 * @module layout-writes-contract
 */

/** Where a set is renamed: its title, and nothing else. */
export const LAYOUT_TITLE_ROUTE_PATH = "/layouts/:id/title";

/** Where a set is copied, as a draft named "Copy of" its title. */
export const LAYOUT_DUPLICATE_ROUTE_PATH = "/layouts/:id/duplicate";

/** The longest title a set may be given here. */
export const LAYOUT_TITLE_MAX = 200;

/** The path a set's rename is sent to. */
export function layoutTitlePath(id: string): string {
  return LAYOUT_TITLE_ROUTE_PATH.replace(":id", encodeURIComponent(id));
}

/** The path a set's copy is asked of. */
export function layoutDuplicatePath(id: string): string {
  return LAYOUT_DUPLICATE_ROUTE_PATH.replace(":id", encodeURIComponent(id));
}

/** A set as a write answers it: enough for the list to show the change. */
export interface WrittenLayout {
  readonly id: string;
  readonly title: string;
}

/**
 * Where a new set is made, from one of three starts: a copy of the site
 * default, the starter header and footer, or empty.
 */
export const LAYOUT_NEW_ROUTE_PATH = "/layouts/new";

/** What a new set starts from. */
export type NewLayoutStart = "copy-default" | "starter" | "empty";

/** Every start, in the order the dialog offers them. */
export const NEW_LAYOUT_STARTS: readonly NewLayoutStart[] = [
  "copy-default",
  "starter",
  "empty",
];

/** What the new set write is sent. */
export interface NewLayoutBody {
  readonly title: string;
  readonly start: NewLayoutStart;
}
