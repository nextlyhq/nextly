/**
 * Reading a comparison out of the address bar.
 *
 * The pair being compared lives in the URL, which makes it something a reader
 * can send to a colleague — and something anyone can type. So these are written
 * as pure functions that treat the query as untrusted input and always answer
 * with something the page can render.
 *
 * @module components/features/versions/version-search-params
 */

/**
 * One numeric search parameter, or undefined for anything that is not a version
 * number. A repeated parameter takes its first value, matching how a browser
 * resolves one.
 *
 * Rejects zero and negatives as well as non-numbers: version numbers start at
 * one, so those are as meaningless as a word and must not reach a request.
 */
export function readVersionParam(
  value: string | string[] | undefined
): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw.trim() === "") return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * The pair to compare: the one the URL names, or the two newest versions.
 *
 * Defaulting rather than refusing, because arriving without a pair is the
 * ordinary case — from the history panel, or from a bookmark of the history
 * itself — and "the most recent change" is what that reader came for. Null only
 * when there is genuinely nothing to compare, which the page states in words
 * rather than showing as an empty comparison.
 *
 * A pair the URL names is taken as given even if those versions are not in the
 * loaded page of history: the list is paginated, and refusing a valid older
 * pair because it has not been fetched yet would break exactly the shared link
 * this feature exists to support. The request that follows is what decides
 * whether the versions exist.
 */
export function resolvePair(
  versionNumbers: readonly number[],
  from: number | undefined,
  to: number | undefined
): { from: number; to: number } | null {
  if (from !== undefined && to !== undefined) return { from, to };
  const [newest, previous] = versionNumbers;
  if (newest === undefined || previous === undefined) return null;
  return { from: previous, to: newest };
}
