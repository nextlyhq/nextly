/**
 * Which two versions a reviewer compares: the version under review, and what
 * it is judged against.
 *
 * The version under review is the part's newest saved version (an autosave is
 * not one), read from the part's own rows only: a language's list also holds
 * the shared fields' versions (`locale: null`), which belong to another part
 * and cannot be compared with a language's. It is compared with the part's
 * last approval where it has one, so a reviewer sees only what changed since
 * they, or a colleague, approved it; else with what is published of the part,
 * which the server resolves from the part's whole history (the `published`
 * baseline) rather than from the one page of it a list holds.
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
      /** What `from` is: the last approval, or the published version. */
      since: "approved" | "published";
      /**
       * The server baseline whose answer resolved the pair and already holds
       * its comparison, where one did.
       */
      seededBy?: string;
    }
  /**
   * Nothing to compare with: the version under review is all new. `reason`
   * is the server's, where it said why.
   */
  | { kind: "first"; to: number; reason?: string }
  /** The version under review is the one approved: nothing changed since. */
  | { kind: "unchanged"; to: number }
  /** No saved version yet. */
  | { kind: "none" };

/**
 * How a part's pair is found: from its approval, which the list answers, or
 * from what is published, which the server's baseline answers for the version
 * under review (`to`; absent where the list's page holds none of the part's
 * own versions, and the server takes the part's newest).
 */
export type ReviewPlan =
  | { kind: "approved"; from: number; to: number }
  | { kind: "unchanged"; to: number }
  | { kind: "published"; to: number | undefined }
  | { kind: "none" };

/**
 * The plan for a part (`part`: its language, or null for the shared part),
 * from its versions newest first and the version number its last approval
 * was given for (null where it has none).
 */
export function reviewPlan(
  versions: readonly VersionMeta[],
  part: string | null,
  approvedVersionNo: number | null
): ReviewPlan {
  const saved = versions.filter(
    (version): version is VersionMeta & { versionNo: number } =>
      version.versionNo !== null && !version.isAutosave
  );
  if (saved.length === 0) return { kind: "none" };
  const newest = saved.find(version => (version.locale ?? null) === part);
  if (approvedVersionNo === null) {
    return { kind: "published", to: newest?.versionNo };
  }
  if (newest === undefined) return { kind: "none" };
  const to = newest.versionNo;
  return approvedVersionNo >= to
    ? { kind: "unchanged", to }
    : { kind: "approved", from: approvedVersionNo, to };
}
