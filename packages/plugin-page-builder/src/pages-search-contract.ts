/**
 * What the pages search answers, named where both ends can read it.
 *
 * The editor's search finds the site's other pages by title as the author
 * types, and a page list reads the same answer with no search at all. A "page"
 * here is an entry of a collection that declares a Page Builder field, the
 * field the editor opens for, so each item names that field: the client builds
 * the editor's address from the collection, the id and the field.
 *
 * FREE OF RUNTIME IMPORTS, for the reason `library-contract.ts` gives: the
 * route reaches the Direct API through `nextly/runtime`, which is server-only,
 * and a browser module importing the route for one path constant would bring
 * it along. The one import below is another contract module, itself free of
 * them, and types are erased before a browser sees them.
 *
 * @module pages-search-contract
 */
import type { PaginationMeta } from "nextly";

import { ENTRIES_SEARCH_MAX, ENTRIES_UNTITLED } from "./entries-contract";

/** Where the editor searches the site's pages, under this plugin's namespace. */
export const PAGES_SEARCH_ROUTE_PATH = "/pages/search";

/**
 * The most pages one search returns, however many were asked for.
 *
 * A search shows a short list the author narrows by typing. Asking for more is
 * capped rather than refused, as the entries route caps, because the list a
 * caller can have serves it better than an error.
 */
export const PAGES_SEARCH_LIMIT_MAX = 20;

/** How many pages a search returns when it names no limit. */
export const PAGES_SEARCH_LIMIT_DEFAULT = 5;

/**
 * The longest search the route accepts, in characters after trimming.
 *
 * The entries route's figure, derived rather than restated: both searches are
 * a title typed into the editor, and both become a `LIKE` pattern a database
 * scans with. Refused rather than cut, because a cut search answers a
 * different question than the one asked.
 */
export const PAGES_SEARCH_MAX: typeof ENTRIES_SEARCH_MAX = ENTRIES_SEARCH_MAX;

/**
 * What a page is called when its title is absent, empty, or not readable by
 * this caller. The entries route's word, for the reason it gives: field-level
 * read access may be what removed the title, so no other field stands in.
 */
export const PAGES_UNTITLED: typeof ENTRIES_UNTITLED = ENTRIES_UNTITLED;

/**
 * The query parameter names, spelled once for the client that writes them and
 * the route that reads them.
 */
export const PAGES_SEARCH_PARAMS = {
  q: "q",
  limit: "limit",
  exclude: "exclude",
} as const;

/**
 * What separates the collection from the id in `exclude`. A collection slug
 * never holds one, so the FIRST one splits the value and an id may hold more.
 */
export const PAGES_SEARCH_EXCLUDE_SEPARATOR = ":";

/** A page's lifecycle state, sent only for a collection with Draft/Published. */
export type PageStatus = "draft" | "published";

/** One page as a search result shows it, and as the editor's address needs it. */
export interface PageItem {
  readonly id: string;
  /** The collection's slug, which the editor's address names. */
  readonly collection: string;
  /** The collection's display name, so a result can say what kind of page it is. */
  readonly collectionLabel: string;
  /** The Page Builder field the editor opens for, by its name. */
  readonly field: string;
  readonly title: string;
  /** Present only when the collection has the Draft/Published lifecycle. */
  readonly status?: PageStatus;
}

/**
 * What the pages search answers: the canonical list envelope, `{ items, meta }`.
 * `items` holds the first matching pages by title that the caller may open.
 *
 * `meta.total` is an UPPER BOUND on how many such pages there are, exact for
 * every collection the search read to its end. Whether a page may be opened
 * is decided row by row (its Page Builder field's read rule), and a search
 * reads a bounded number of rows per collection, so the total counts the
 * openable pages among the rows read plus every match it did not read. It is
 * never smaller than the true count, so `meta.hasNext` false means no more.
 */
export interface PagesSearchResponse {
  readonly items: readonly PageItem[];
  readonly meta: PaginationMeta;
}

/** One page, named the way `exclude` names it. */
export interface PageReference {
  readonly collection: string;
  readonly id: string;
}

/** What one search asks for, as the client states it. */
export interface PagesSearchQuery {
  /** Pages whose title holds this, ignoring case. Absent, every page. */
  readonly q?: string;
  /** How many to return; capped at {@link PAGES_SEARCH_LIMIT_MAX}. */
  readonly limit?: number;
  /** A page to leave out, ordinarily the one being edited. */
  readonly exclude?: PageReference;
}

/**
 * The route's path for one search, query string included.
 *
 * An absent or empty value is left out rather than sent empty, so the route
 * sees "not asked" rather than an empty string it would have to interpret.
 */
export function pagesSearchPath(query: PagesSearchQuery = {}): string {
  const params = new URLSearchParams();
  if (query.q !== undefined && query.q !== "") {
    params.set(PAGES_SEARCH_PARAMS.q, query.q);
  }
  if (query.limit !== undefined) {
    params.set(PAGES_SEARCH_PARAMS.limit, String(query.limit));
  }
  if (query.exclude !== undefined) {
    params.set(
      PAGES_SEARCH_PARAMS.exclude,
      `${query.exclude.collection}${PAGES_SEARCH_EXCLUDE_SEPARATOR}${query.exclude.id}`
    );
  }
  const search = params.toString();
  return search === ""
    ? PAGES_SEARCH_ROUTE_PATH
    : `${PAGES_SEARCH_ROUTE_PATH}?${search}`;
}
