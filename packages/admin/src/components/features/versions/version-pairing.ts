/**
 * Which version a version is compared against.
 *
 * One implementation, because three surfaces ask it — the history panel, the
 * comparison page's rail, and the page itself — and they had begun to disagree.
 * The panel answered it within one locale; the page answered it by position in
 * the flat list, which pairs a version with whatever happens to sit below it.
 * On a localized document that is a version in another language, and the server
 * rejects the pair outright.
 *
 * Two rules the flat answer cannot express, both of them content rather than
 * presentation:
 *
 * A comparison must stay within ONE LOCALE. A localized document interleaves
 * its languages in one numbered history, so consecutive numbers routinely
 * belong to different languages and are not a before-and-after of anything.
 *
 * The predecessor is the next-older row IN THAT SET, never `versionNo - 1`.
 * Retention prunes old versions and leaves gaps in the numbering, so arithmetic
 * on the number names a version that may no longer exist.
 *
 * @module components/features/versions/version-pairing
 */

/** The least a row must carry to be paired. */
export interface PairableVersion {
  versionNo: number | null;
  locale?: string | null;
}

/**
 * What sits before a version in its own locale.
 *
 * `unknown` is the entry that matters and the one a boolean cannot hold. A row
 * at the bottom of a loaded page has no predecessor IN HAND, which is not the
 * same as having none — and collapsing the two tells a reader that a version
 * with ten older siblings is the first ever recorded, then makes selecting it
 * do nothing. The two answers point a reader in opposite directions, so they
 * are kept apart here rather than repaired in each consumer.
 */
export type Predecessor =
  | { kind: "version"; versionNo: number }
  | { kind: "first" }
  | { kind: "unknown" };

/** A row's locale, with an absent one and a null one meaning the same thing. */
function localeOf(version: PairableVersion): string | null {
  return version.locale ?? null;
}

/**
 * The versions sharing one version's locale, newest first.
 *
 * Autosave rows carry a null `versionNo` and cannot be compared, so they are
 * not in the set — a pair must name two versions the server can fetch.
 */
export function sameLocaleVersions<T extends PairableVersion>(
  versions: readonly T[],
  versionNo: number
): T[] {
  const anchor = versions.find(v => v.versionNo === versionNo);
  if (anchor === undefined) return [];
  const locale = localeOf(anchor);
  return versions.filter(v => v.versionNo !== null && localeOf(v) === locale);
}

/**
 * What `versionNo` is compared against.
 *
 * `hasMore` is whether the history has pages still unloaded. It is what
 * separates "there is nothing older" from "nothing older has been fetched", and
 * a caller that cannot say should pass `true` — claiming a version is the first
 * on record is the answer that misleads.
 */
export function predecessorOf(
  versions: readonly PairableVersion[],
  versionNo: number,
  hasMore: boolean
): Predecessor {
  const sameLocale = sameLocaleVersions(versions, versionNo);
  const index = sameLocale.findIndex(v => v.versionNo === versionNo);
  // The row itself is not loaded, so nothing about what precedes it is known.
  if (index === -1) return { kind: "unknown" };

  const previous = sameLocale[index + 1];
  if (previous?.versionNo != null) {
    return { kind: "version", versionNo: previous.versionNo };
  }
  // Nothing older IN THIS LOCALE has loaded. Whether that is the end of the
  // history or the end of the page is a question only the pager can answer, and
  // interleaved locales put a predecessor beyond the page long before the
  // selected row is the last one loaded overall.
  return hasMore ? { kind: "unknown" } : { kind: "first" };
}

/**
 * A pair to compare, or the reason there is none.
 *
 * The reasons are kept apart because they are three different situations and a
 * reader acts differently on each: a document with no history at all, one whose
 * history holds a single version, and one whose older versions simply have not
 * been fetched. Collapsing them into a null pair made the pane tell someone
 * with no versions that they had exactly one.
 */
export type PairResolution =
  | { kind: "pair"; from: number; to: number }
  | { kind: "no-history" }
  | { kind: "only-version" }
  | { kind: "not-loaded" };

/**
 * The pair to compare when the address names none: the newest version and what
 * precedes it, within one locale.
 */
export function defaultPair(
  versions: readonly PairableVersion[],
  hasMore: boolean
): PairResolution {
  const newest = versions.find(v => v.versionNo !== null);
  if (newest?.versionNo == null) return { kind: "no-history" };
  const previous = predecessorOf(versions, newest.versionNo, hasMore);
  if (previous.kind === "version") {
    return { kind: "pair", from: previous.versionNo, to: newest.versionNo };
  }
  // `first` means this document really does hold one version; `unknown` means
  // its predecessor is beyond the loaded pages and "Load more" would find it.
  return previous.kind === "first"
    ? { kind: "only-version" }
    : { kind: "not-loaded" };
}
