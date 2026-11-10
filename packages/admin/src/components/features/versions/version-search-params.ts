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

import {
  defaultPair,
  pairEndingAt,
  type PairableVersion,
  type PairResolution,
} from "./version-pairing";

/**
 * What a comparison's `from` may name besides a version number: the version
 * before `to` in its own language, for a link that knows the change it wants
 * to show but not the number of the version before it.
 */
export const PREVIOUS_VERSION = "previous";

/** A comparison's start: a version number, or the one before `to`. */
export type ComparisonFrom = number | typeof PREVIOUS_VERSION;

/**
 * A comparison's `from`: a version number, as `readVersionParam` reads one, or
 * the named baseline `previous`. A repeated parameter takes its first value.
 */
export function readFromParam(
  value: string | string[] | undefined
): ComparisonFrom | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === PREVIOUS_VERSION ? PREVIOUS_VERSION : readVersionParam(raw);
}

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
/**
 * The content language a comparison is about, from the address.
 *
 * A version's locale decides which text the document HAS, so it decides what
 * the document is called. Carried in the URL rather than inferred, because the
 * page is addressable: a link shared from a French history has to open on the
 * French comparison, named in French, for someone whose editor was last in
 * English.
 *
 * Absent means the default language, which is what the server resolves when no
 * locale is asked for — so a non-localized document needs no parameter and
 * gains none.
 */
export function readLocaleParam(
  raw: string | string[] | undefined
): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function resolvePair(
  versions: readonly PairableVersion[],
  from: ComparisonFrom | undefined,
  to: number | undefined,
  hasMore: boolean
): PairResolution {
  if (from === PREVIOUS_VERSION && to !== undefined) {
    // The change `to` made: compared with the version before it in its own
    // language, as choosing it in the history does.
    return pairEndingAt(versions, to, hasMore);
  }
  if (typeof from === "number" && to !== undefined) {
    return { kind: "pair", from, to };
  }
  // The default pair is derived rather than read off the top of the list: on a
  // localized document the two newest rows are routinely different languages,
  // and the server rejects a cross-locale pair — so a page opened with no
  // parameters would render an API error instead of the most recent change.
  return defaultPair(versions, hasMore);
}
