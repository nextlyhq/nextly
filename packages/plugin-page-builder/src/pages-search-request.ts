/**
 * What a pages search is asked: the query it parses, with its search,
 * order, exclusions and limit, and the cursor that carries each
 * collection's position from one page of results to the next.
 *
 * Part of the pages search. `pages-search-route.ts` is the entry, and its
 * header explains what the search reads, who decides access, and paging.
 *
 * @module pages-search-request
 */
import { z } from "nextly/zod";

import {
  PAGES_SEARCH_CURSOR_MAX,
  PAGES_SEARCH_EXCLUDE_SEPARATOR,
  PAGES_SEARCH_LIMIT_DEFAULT,
  PAGES_SEARCH_LIMIT_MAX,
  PAGES_SEARCH_LOCALE_MAX,
  PAGES_SEARCH_MAX,
  PAGES_SEARCH_PARAMS,
  type PageReference,
  type PagesSearchOrder,
} from "./pages-search-contract";
import { cappedLimit, optionalText, parseRouteQuery } from "./route-query";

/**
 * The longest collection slug or id `exclude` accepts. Ids are uuids or short
 * integers and slugs are short names; a bound keeps one oversized value from
 * travelling into a where clause.
 */
export const EXCLUDE_PART_MAX = 200;

/** A search the route will make, once its query has been checked. */
export interface PagesSearchRequest {
  /** Trimmed, non-empty, at most {@link PAGES_SEARCH_MAX} characters. */
  readonly search?: string;
  /** Between 1 and {@link PAGES_SEARCH_LIMIT_MAX}. */
  readonly limit: number;
  /** The page left out, ordinarily the one being edited. */
  readonly exclude?: PageReference;
  /** Where an earlier page of the same search stopped; the first page when absent. */
  readonly before?: PagesCursor;
  /** How the pages are ordered: by title, or by collection. */
  readonly order: PagesSearchOrder;
  /** The language each page is searched and named in, when the request names one. */
  readonly locale?: string;
}

/**
 * Where a search stopped: how many pages it has answered, and for each
 * collection how many rows of its read, in that read's own order, are behind
 * it. A collection it names no position for starts at its first row.
 */
export interface PagesCursor {
  /** The page this cursor opens, from 2. */
  readonly page: number;
  readonly at: Readonly<Record<string, number>>;
}

/** The most collections one cursor names, and the furthest row and page it may. */
const CURSOR_COLLECTIONS_MAX = 200;

const CURSOR_ROW_MAX = 1_000_000_000;

const CURSOR_PAGE_MAX = 1_000_000;

/** A cursor's decoded shape; anything else is not a cursor this route wrote. */
const cursorShape = z.strictObject({
  page: z.number().int().min(2).max(CURSOR_PAGE_MAX),
  at: z
    .record(
      z.string().min(1).max(200),
      z.number().int().min(0).max(CURSOR_ROW_MAX)
    )
    .refine(at => Object.keys(at).length <= CURSOR_COLLECTIONS_MAX),
});

/**
 * A cursor as the route writes it: its JSON, base64url-encoded, so it travels
 * in a query string as one opaque value the client hands back unread.
 */
export function encodePagesCursor(cursor: PagesCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/** A cursor's JSON, or `undefined` for a value that is not base64url JSON. */
function decodeCursor(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

/**
 * `exclude` as written, split at its FIRST separator so an id may hold more.
 * No separator leaves the id empty, which the schema below refuses.
 */
function splitReference(value: string): { collection: string; id: string } {
  const at = value.indexOf(PAGES_SEARCH_EXCLUDE_SEPARATOR);
  if (at === -1) return { collection: value.trim(), id: "" };
  return {
    collection: value.slice(0, at).trim(),
    id: value.slice(at + PAGES_SEARCH_EXCLUDE_SEPARATOR.length).trim(),
  };
}

/**
 * The query, as zod reads it. The limit and the search take the shapes every
 * editor read route shares; `exclude` with either half empty is refused, since
 * it would name no page.
 */
const querySchema = z.object({
  [PAGES_SEARCH_PARAMS.q]: optionalText(PAGES_SEARCH_MAX),
  [PAGES_SEARCH_PARAMS.limit]: cappedLimit(PAGES_SEARCH_LIMIT_MAX).optional(),
  [PAGES_SEARCH_PARAMS.exclude]: z
    .string()
    .transform(splitReference)
    .pipe(
      z.object({
        collection: z.string().min(1).max(EXCLUDE_PART_MAX),
        id: z.string().min(1).max(EXCLUDE_PART_MAX),
      })
    )
    .optional(),
  // Decoded and checked here, so a cursor the route did not write is refused
  // at the boundary like any other parameter, its value never echoed.
  [PAGES_SEARCH_PARAMS.before]: z
    .string()
    .max(PAGES_SEARCH_CURSOR_MAX)
    .transform(decodeCursor)
    .pipe(cursorShape)
    .optional(),
  [PAGES_SEARCH_PARAMS.order]: z.enum(["title", "collection"]).optional(),
  [PAGES_SEARCH_PARAMS.locale]: optionalText(PAGES_SEARCH_LOCALE_MAX),
});

/**
 * Read the request's query into a {@link PagesSearchRequest}, or refuse it,
 * through the shared parse-or-refuse step: a refusal names the parameter and
 * never echoes its value.
 */
export function parsePagesSearchQuery(url: string | URL): PagesSearchRequest {
  const query = parseRouteQuery(
    url,
    Object.values(PAGES_SEARCH_PARAMS),
    querySchema,
    "pages search"
  );
  const search = query[PAGES_SEARCH_PARAMS.q];
  const exclude = query[PAGES_SEARCH_PARAMS.exclude];
  const before = query[PAGES_SEARCH_PARAMS.before];
  const locale = query[PAGES_SEARCH_PARAMS.locale];
  return {
    ...(search === undefined ? {} : { search }),
    limit: query[PAGES_SEARCH_PARAMS.limit] ?? PAGES_SEARCH_LIMIT_DEFAULT,
    ...(exclude === undefined ? {} : { exclude }),
    ...(before === undefined ? {} : { before }),
    order: query[PAGES_SEARCH_PARAMS.order] ?? "title",
    ...(locale === undefined ? {} : { locale }),
  };
}
