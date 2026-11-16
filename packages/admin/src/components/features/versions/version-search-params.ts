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
  type ServerBaseline,
} from "./version-pairing";

/**
 * What a comparison's `from` may name besides a version number: the version
 * before `to` in its own language, for a link that knows the change it wants
 * to show but not the number of the version before it.
 */
export const PREVIOUS_VERSION = "previous";

/**
 * A comparison's start: a version number, the one before `to`
 * (`PREVIOUS_VERSION`), or a baseline the server resolves (what is published,
 * the current draft, the version this person last looked at, or one another
 * feature registers), named as the server names it. Any baseline name is a
 * string, so the word for the one before `to` is one of them by type, and
 * told apart by `namesServerBaseline`.
 */
export type ComparisonFrom = number | ServerBaseline;

/**
 * The shape of a baseline's name: kebab-case, starting with a letter. The
 * server registers no name of any other shape, so nothing outside it can name
 * one. WHICH names exist is the server's to say: a well-formed name goes to
 * it, and one it does not know is refused there with the names it does.
 */
const BASELINE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function isServerBaseline(value: string): boolean {
  return BASELINE_NAME.test(value);
}

/**
 * Whether a comparison's start is a baseline only the server resolves, which
 * it can pair with a version of its own choosing when the address names none.
 *
 * A plain answer rather than a type guard: every baseline name is a string,
 * the word for the version before `to` included, so a guard would claim that
 * word impossible wherever it answered false.
 */
export function namesServerBaseline(from: ComparisonFrom): boolean {
  return typeof from === "string" && from !== PREVIOUS_VERSION;
}

/**
 * A comparison's `from`: a version number, as `readVersionParam` reads one, or
 * a named baseline. A repeated parameter takes its first value.
 */
export function readFromParam(
  value: string | string[] | undefined
): ComparisonFrom | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === PREVIOUS_VERSION) return PREVIOUS_VERSION;
  if (raw !== undefined && isServerBaseline(raw)) return raw;
  return readVersionParam(raw);
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
  // Only the server knows what is published, drafted or last looked at.
  if (typeof from === "string" && namesServerBaseline(from)) {
    return to === undefined
      ? { kind: "baseline", baseline: from }
      : { kind: "baseline", baseline: from, to };
  }
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

/**
 * How the address asks a comparison to be drawn: inline, or side by side.
 * Anything else leaves the reader's own remembered choice in place.
 */
export function readViewParam(
  value: string | string[] | undefined
): "inline" | "side" | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "inline" || raw === "side" ? raw : undefined;
}
