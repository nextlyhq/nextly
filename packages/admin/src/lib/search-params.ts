/**
 * Reading a URL's query string.
 *
 * Separate from `lib/routing` on purpose. Routing resolves a path against the
 * page registry, so it imports every page in the admin — and these helpers are
 * used BY pages and by the hooks pages call, which closed a cycle back onto
 * itself through a module none of them actually needed. Parsing a query string
 * has nothing to do with knowing what routes exist, so it lives where anything
 * can reach it.
 *
 * @module lib/search-params
 */

export type SearchParams = Record<string, string | string[] | undefined>;

/** Parse a URL search string into a plain record, keeping repeated keys as arrays. */
export function parseSearchParams(search: string): SearchParams {
  const usp = new URLSearchParams(search);
  const out: SearchParams = {};
  for (const key of Array.from(new Set(Array.from(usp.keys())))) {
    const values = usp.getAll(key);
    out[key] =
      values.length === 0
        ? undefined
        : values.length === 1
          ? values[0]
          : values;
  }
  return out;
}

/**
 * Read a single search-param value, mirroring `URLSearchParams.get()`: the
 * first value when a key is repeated, and `null` when it is absent.
 */
export function getSearchParam(
  params: SearchParams,
  key: string
): string | null {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
