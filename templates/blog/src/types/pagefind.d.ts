/**
 * Types for the Pagefind browser bundle served at `/pagefind/pagefind.js`.
 *
 * The bundle is generated into `public/pagefind/` by `scripts/build-search-index.mjs`
 * during the build, so it does not exist while type-checking and TypeScript can
 * infer nothing from it. The `pagefind` npm package ships types for its Node
 * indexing service only, not for this browser search API, so the surface below is
 * declared from Pagefind's documented JS API.
 *
 * This file is reached through the `paths` entry for `/pagefind/pagefind.js` in
 * `tsconfig.json`, NOT through `declare module`: TypeScript classifies a rooted
 * specifier as relative and rejects an ambient declaration naming one with
 * TS2436, so a `paths` mapping is what lets the literal import keep the absolute
 * URL the browser needs.
 *
 * Fields are optional where the API only populates them under a condition:
 * `filters`/`totalFilters` arrive once `filters()` has been awaited, and
 * `plain_excerpt`, `sub_results` and `anchors` depend on how the site was indexed.
 */

/** A heading Pagefind recorded so a result can deep-link into a page. */
export interface PagefindAnchor {
  element: string;
  id?: string;
  text?: string;
  location: number;
}

/** A match scoped to one section of a page, used to link past the page top. */
export interface PagefindSubResult {
  title: string;
  url: string;
  excerpt: string;
  plain_excerpt?: string;
  anchor?: PagefindAnchor;
}

/**
 * The loaded record for one result. `excerpt` contains `<mark>` elements around
 * the matched terms, so it is rendered as HTML rather than as text.
 */
export interface PagefindDocument {
  url: string;
  raw_url?: string;
  content?: string;
  excerpt: string;
  plain_excerpt?: string;
  word_count?: number;
  meta?: Record<string, string | undefined> & { title?: string };
  filters?: Record<string, string[]>;
  sub_results?: PagefindSubResult[];
  anchors?: PagefindAnchor[];
  locations?: number[];
}

/**
 * A result before its record is loaded. `data()` fetches the fragment for this
 * result alone, which is what keeps the initial search payload small.
 */
export interface PagefindSearchResult {
  id: string;
  score?: number;
  words?: number[];
  data: () => Promise<PagefindDocument>;
}

/** Counts per filter value; present only after `filters()` has been awaited. */
export type PagefindFilterCounts = Record<string, Record<string, number>>;

export interface PagefindSearchResults {
  results: PagefindSearchResult[];
  unfilteredResultCount?: number;
  filters?: PagefindFilterCounts;
  totalFilters?: PagefindFilterCounts;
}

export interface PagefindSearchOptions {
  filters?: Record<string, string | string[]>;
  sort?: Record<string, "asc" | "desc">;
}

export interface PagefindOptions {
  baseUrl?: string;
  bundlePath?: string;
  excerptLength?: number;
  highlightParam?: string;
  ranking?: Record<string, number>;
}

/**
 * Loads the index eagerly. Optional: `search()` initialises on first call, so
 * this only moves that cost to mount time.
 */
export function init(): Promise<void>;

export function options(options: PagefindOptions): Promise<void>;

/**
 * `null` as the term clears the current search rather than searching for
 * nothing, which is how an emptied input resets results.
 */
export function search(
  term: string | null,
  options?: PagefindSearchOptions
): Promise<PagefindSearchResults>;

/** Warms the index for a term without running a search. */
export function preload(
  term: string,
  options?: PagefindSearchOptions
): Promise<void>;

/**
 * Resolves to `null` when a later call supersedes this one, so a caller must
 * handle null rather than treating every resolution as a result set.
 */
export function debouncedSearch(
  term: string | null,
  options?: PagefindSearchOptions,
  debounceTimeoutMs?: number
): Promise<PagefindSearchResults | null>;

export function filters(): Promise<PagefindFilterCounts>;

export function destroy(): Promise<void>;
