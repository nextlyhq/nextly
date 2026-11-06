/**
 * What the entries route answers, named where both ends can read it.
 *
 * A block prop declared `{ type: "relation", relationTo: "<collection>" }`
 * stores the id of one entry of that collection, and the inspector's control
 * for it needs two reads: the entries matching what the author types, and the
 * title of the entry a prop already stores. Both are one route, and this module
 * is what the route and the admin client agree on.
 *
 * FREE OF RUNTIME IMPORTS, for the reason `library-contract.ts` gives: the
 * route reaches the Direct API through `nextly/runtime`, which is server-only,
 * and a browser module importing the route for one path constant would bring
 * it along. Types are the exception, since they are erased before a browser
 * sees them.
 *
 * @module entries-contract
 */
import type { PaginationMeta } from "nextly";

/** Where the inspector finds a collection's entries, under this plugin's namespace. */
export const ENTRIES_ROUTE_PATH = "/entries";

/**
 * The most entries one read returns, however many were asked for.
 *
 * A picker shows a short list the author narrows by typing, so a larger page
 * is bytes nobody reads. Asking for more is not refused but capped, because a
 * caller that wants a longer list is better served by the list it can have
 * than by an error.
 */
export const ENTRIES_LIMIT_MAX = 25;

/** How many entries a read returns when it names no limit. */
export const ENTRIES_LIMIT_DEFAULT = 10;

/**
 * The longest search the route accepts, in characters after trimming.
 *
 * A title search is a few words; a longer one is not a person typing, and it
 * becomes a `LIKE` pattern the database has to scan with. Refused rather than
 * cut, because a cut search answers a different question than the one asked.
 */
export const ENTRIES_SEARCH_MAX = 100;

/**
 * The most ids one resolve may name.
 *
 * The same figure as the page ceiling, and derived from it: a resolve answers
 * in one page, so naming more ids than a page holds would ask for rows the
 * answer cannot carry.
 */
export const ENTRIES_IDS_MAX: typeof ENTRIES_LIMIT_MAX = ENTRIES_LIMIT_MAX;

/**
 * What an entry is called when its title field is absent, empty, or not
 * readable by this caller.
 *
 * A neutral word rather than the id or any other field: field-level read
 * access may be exactly what removed the title, and labelling the entry with
 * something else would show the author a value the collection chose to keep
 * from them. The same word the admin's dashboard uses for an untitled entry.
 */
export const ENTRIES_UNTITLED = "Untitled";

/**
 * The query parameter names, spelled once for the client that writes them and
 * the route that reads them. Two spellings agree until one is renamed, and a
 * parameter the route does not read is silently ignored.
 */
export const ENTRIES_PARAMS = {
  collection: "collection",
  search: "search",
  ids: "ids",
  limit: "limit",
  locale: "locale",
} as const;

/** The longest language code the route accepts, past any real BCP 47 tag. */
export const ENTRIES_LOCALE_MAX = 35;

/** One entry as a relation control shows it: its id and its title, nothing else. */
export interface EntryItem {
  readonly id: string;
  readonly title: string;
}

/**
 * What the entries route answers: the canonical list envelope, `{ items, meta }`,
 * with the pagination meta of the read it made.
 */
export interface EntriesResponse {
  readonly items: readonly EntryItem[];
  readonly meta: PaginationMeta;
}

/** What one read asks for, as the client states it. */
export interface EntriesQuery {
  /** The collection to read: one a registered block names as a relation target. */
  readonly collection: string;
  /** Entries whose title holds this, ignoring case. */
  readonly search?: string;
  /** These entries by id, to name the ones a prop stores. */
  readonly ids?: readonly string[];
  /** How many to return; capped at {@link ENTRIES_LIMIT_MAX}. */
  readonly limit?: number;
  /**
   * The language being edited, so titles are searched and named in it. Left
   * out, the site's default language, as every Direct API read without one.
   */
  readonly locale?: string;
}

/**
 * The route's path for one read, query string included.
 *
 * An absent or empty value is left out rather than sent empty, so the route
 * sees "not asked" rather than an empty string it would have to interpret.
 * `ids` travel comma-separated, which is the form the route parses.
 */
export function entriesPath(query: EntriesQuery): string {
  const params = new URLSearchParams({
    [ENTRIES_PARAMS.collection]: query.collection,
  });
  if (query.search !== undefined && query.search !== "") {
    params.set(ENTRIES_PARAMS.search, query.search);
  }
  if (query.ids !== undefined && query.ids.length > 0) {
    params.set(ENTRIES_PARAMS.ids, query.ids.join(","));
  }
  if (query.limit !== undefined) {
    params.set(ENTRIES_PARAMS.limit, String(query.limit));
  }
  if (query.locale !== undefined && query.locale !== "") {
    params.set(ENTRIES_PARAMS.locale, query.locale);
  }
  return `${ENTRIES_ROUTE_PATH}?${params.toString()}`;
}
