/**
 * What the Pages panel's writes take and answer, named where both ends can
 * read them: create a page, duplicate one, rename one, delete one.
 *
 * A page is an entry of a collection the pages search lists (see
 * `pages-search-contract`), and every answer names it the way a search result
 * does, so the panel can put a written page in its list without reading again.
 *
 * FREE OF RUNTIME IMPORTS, for the reason `pages-search-contract.ts` gives: the
 * routes reach the Direct API through `nextly/runtime`, which is server-only.
 * The one import is another contract module, and only its types.
 *
 * @module pages-write-contract
 */
import type { PageItem, PageReference } from "./pages-search-contract";

/** Where a page is created, under this plugin's namespace. */
export const PAGES_ROUTE_PATH = "/pages";

/** One page, renamed with PATCH and deleted with DELETE. */
export const PAGE_ROUTE_PATH = "/pages/:collection/:id";

/** Where a page is duplicated. */
export const PAGE_DUPLICATE_ROUTE_PATH = "/pages/:collection/:id/duplicate";

/**
 * The longest title a page may be given, in characters after trimming.
 * Refused rather than cut above it, because a cut title is not the one typed.
 */
export const PAGE_TITLE_MAX = 200;

/** What creates a page: the collection it goes in and its title. */
export interface CreatePageRequest {
  readonly collection: string;
  readonly title: string;
}

/**
 * What renames a page: its new title, and nothing else, with the version of
 * the page the author renamed (the `rev` the search gave it), so a save of
 * the page since refuses the rename rather than being lost under it.
 */
export interface RenamePageRequest {
  readonly title: string;
  readonly rev?: string;
}

/**
 * A page write's answer: the canonical mutation envelope. Create, duplicate
 * and rename answer the page as the search lists it; delete answers only which
 * page it was, since there is nothing left to describe.
 */
export interface PageMutationResponse<TItem extends PageItem | PageReference> {
  readonly message: string;
  readonly item: TItem;
}

/** `path` with one page's collection and id written in. */
function pageAddress(path: string, page: PageReference): string {
  return path
    .replace(":collection", encodeURIComponent(page.collection))
    .replace(":id", encodeURIComponent(page.id));
}

/** The path that renames or deletes `page`. */
export function pagePath(page: PageReference): string {
  return pageAddress(PAGE_ROUTE_PATH, page);
}

/** The path that duplicates `page`. */
export function pageDuplicatePath(page: PageReference): string {
  return pageAddress(PAGE_DUPLICATE_ROUTE_PATH, page);
}
