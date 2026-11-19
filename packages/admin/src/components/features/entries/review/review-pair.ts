/**
 * Which two versions a reviewer compares: the version under review, and what
 * it is judged against.
 *
 * The version under review is the part's newest saved version (an autosave is
 * not one). It is compared with the part's last approval where it has one, so
 * a reviewer sees only what changed since they, or a colleague, approved it;
 * else with the part's last published version; else there is nothing before
 * it, and the whole version is new.
 *
 * @module components/features/entries/review/review-pair
 */

import type { VersionMeta } from "@admin/services/versionApi";

/** The comparison a review shows. */
export type ReviewPair =
  | {
      kind: "pair";
      from: number;
      to: number;
      /** What `from` is: the last approval, or the last published version. */
      since: "approved" | "published";
    }
  /** Nothing to compare with: the version under review is all new. */
  | { kind: "first"; to: number }
  /** The version under review is the one approved: nothing changed since. */
  | { kind: "unchanged"; to: number }
  /** No saved version yet. */
  | { kind: "none" };

/**
 * The pair for a part, from its versions newest first and the version number
 * its last approval was given for (null where it has none).
 */
export function reviewPair(
  versions: readonly VersionMeta[],
  approvedVersionNo: number | null
): ReviewPair {
  const saved = versions.filter(
    (version): version is VersionMeta & { versionNo: number } =>
      version.versionNo !== null && !version.isAutosave
  );
  const newest = saved[0];
  if (newest === undefined) return { kind: "none" };
  const to = newest.versionNo;
  if (approvedVersionNo !== null) {
    return approvedVersionNo >= to
      ? { kind: "unchanged", to }
      : { kind: "pair", from: approvedVersionNo, to, since: "approved" };
  }
  const published = saved.find(
    version => version.status === "published" && version.versionNo < to
  );
  return published === undefined
    ? { kind: "first", to }
    : { kind: "pair", from: published.versionNo, to, since: "published" };
}
