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

import {
  ENTRIES_LOCALE_MAX,
  ENTRIES_SEARCH_MAX,
  ENTRIES_UNTITLED,
} from "./entries-contract";

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
 * The longest locale code the route accepts. The entries route's figure,
 * derived rather than restated: both name the language an editor reads in.
 */
export const PAGES_SEARCH_LOCALE_MAX: typeof ENTRIES_LOCALE_MAX =
  ENTRIES_LOCALE_MAX;

/**
 * The query parameter names, spelled once for the client that writes them and
 * the route that reads them.
 */
export const PAGES_SEARCH_PARAMS = {
  q: "q",
  limit: "limit",
  exclude: "exclude",
  before: "before",
  order: "order",
  locale: "locale",
} as const;

/**
 * How a search's pages are ordered. `title`, the default, is the best matches
 * first across every collection, for a search that shows a few; `collection`
 * is each collection's pages together, the plugin's own Pages first and the
 * others by name, each in title order, for a list grouped by collection.
 */
export type PagesSearchOrder = "title" | "collection";

/**
 * The longest cursor the route accepts, in characters. A cursor names a
 * position in each page collection, and a site has few of them; the bound keeps
 * one oversized value from being decoded at all.
 */
export const PAGES_SEARCH_CURSOR_MAX = 4096;

/**
 * What separates the collection from the id in `exclude`. A collection slug
 * never holds one, so the FIRST one splits the value and an id may hold more.
 */
export const PAGES_SEARCH_EXCLUDE_SEPARATOR = ":";

/** A page's lifecycle state, sent only for a collection with Draft/Published. */
export type PageStatus = "draft" | "published";

/**
 * Where a page stands in publishing when that is not plainly published, in the
 * admin's own words for its status pill (`PILL_LABEL` names each): `draft`, never
 * published; `changed`, published with a working draft not yet published; and
 * `scheduled`, which a scheduled release will publish. A publish that is
 * scheduled is what the author has to know first, so it wins over the other two.
 */
export type PageState = "draft" | "changed" | "scheduled";

/** One page as a search result shows it, and as the editor's address needs it. */
export interface PageItem {
  readonly id: string;
  /** The collection's slug, which the editor's address names. */
  readonly collection: string;
  /** The collection's display name, so a result can say what kind of page it is. */
  readonly collectionLabel: string;
  /**
   * The collection's plural name ("Landing pages"), for a heading over its
   * pages. Absent where the collection names no plural.
   */
  readonly collectionPluralLabel?: string;
  /** The Page Builder field the editor opens for, by its name. */
  readonly field: string;
  /**
   * Where the page is served on the site (`/pricing`), resolved on the server
   * from where the host said its pages are served. Present for the plugin's
   * own Pages with a slug; absent for any other collection.
   */
  readonly path?: string;
  readonly title: string;
  /** Present only when the collection has the Draft/Published lifecycle. */
  readonly status?: PageStatus;
  /**
   * Present only when the page is not plainly published: absent for a
   * published page with nothing waiting, and for a collection without the
   * Draft/Published lifecycle. Sent by the search; a write's answer leaves it
   * out, since a write does not read where its page stands in a release.
   */
  readonly state?: PageState;
  /**
   * Present when the page holds changes not yet published, whatever its state
   * says: a scheduled page can hold them too. Absent otherwise.
   */
  readonly pendingChange?: true;
  /**
   * The page's version as this answer read it, which a rename sends back so
   * a save of the page since then refuses the rename. Absent from a server
   * that issues no versions.
   */
  readonly rev?: string;
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
 *
 * ## Paging
 *
 * By cursor, not by page number. Each page collection is read in its own
 * database's title order and the answer is merged from their heads, so where a
 * page ends is a position in EACH collection; `meta.nextBefore` names those
 * positions, and sending it back as `before` continues the merge exactly where
 * it stopped, with no page repeated or skipped. A page number would have to
 * re-read every earlier page from every collection to find the same positions.
 * `meta.nextBefore` is present exactly when `meta.hasNext` is; `meta.page`
 * counts the pages walked, from 1.
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
  /**
   * Where to continue from: the previous answer's `meta.nextBefore`, sent with
   * the same `q`, `limit`, `exclude` and `order`.
   */
  readonly before?: string;
  /** How the pages are ordered; by title when absent. */
  readonly order?: PagesSearchOrder;
  /**
   * The language to search and name the pages in: the one being edited, so a
   * localized title reads as the author sees it. The default locale when absent.
   */
  readonly locale?: string;
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
  if (query.before !== undefined && query.before !== "") {
    params.set(PAGES_SEARCH_PARAMS.before, query.before);
  }
  // The default is left out, as an absent value is.
  if (query.order === "collection") {
    params.set(PAGES_SEARCH_PARAMS.order, query.order);
  }
  if (query.locale !== undefined && query.locale !== "") {
    params.set(PAGES_SEARCH_PARAMS.locale, query.locale);
  }
  const search = params.toString();
  return search === ""
    ? PAGES_SEARCH_ROUTE_PATH
    : `${PAGES_SEARCH_ROUTE_PATH}?${search}`;
}

/**
 * Where the editor asks the address one page is served at, for Settings'
 * address line. A read of its own rather than a search: Settings knows the
 * page and asks only where it is, as the page is saved.
 */
export const PAGE_ADDRESS_ROUTE_PATH = "/pages/address";

/** The address route's query parameter names, spelled once for both ends. */
export const PAGE_ADDRESS_PARAMS = {
  collection: "collection",
  id: "id",
  locale: "locale",
} as const;

/**
 * What the address route answers: where the page is served as it is SAVED,
 * resolved on the server from where the host said its pages are served, by
 * the interpolation the pages search and the collection's preview use.
 * `null` where it has none: another collection's page, a host that states no
 * address for its pages, or a page whose saved fields cannot fill it yet.
 */
export interface PageAddressResponse {
  readonly path: string | null;
}

/** The address route's path for one page, in the language being edited. */
export function pageAddressPath(page: PageReference, locale?: string): string {
  const params = new URLSearchParams({
    [PAGE_ADDRESS_PARAMS.collection]: page.collection,
    [PAGE_ADDRESS_PARAMS.id]: page.id,
  });
  if (locale !== undefined && locale !== "") {
    params.set(PAGE_ADDRESS_PARAMS.locale, locale);
  }
  return `${PAGE_ADDRESS_ROUTE_PATH}?${params.toString()}`;
}
