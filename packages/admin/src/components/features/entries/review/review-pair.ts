/**
 * Which two versions a reviewer compares: the version under review, and what
 * it is judged against.
 *
 * The version under review is the part's newest saved version (an autosave is
 * not one): a language's own newest, never a newer shared-fields row its list
 * also holds; the shared part's, the document's newest in any language. It is
 * compared with the part's last approval where it had one, so a reviewer sees
 * only what changed since they, or a colleague, approved it; else with what is
 * published of the part. The server resolves both from the part's whole
 * history rather than from the one page of it a list holds.
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
 * How a part's pair is found: nothing changed since its approval, which the
 * list answers, or a comparison the server resolves for the version under
 * review (`to`; absent where the list's page holds none of the part's own
 * versions, and the server takes the part's newest): since the part was last
 * approved, else since what is published.
 */
export type ReviewPlan =
  | { kind: "unchanged"; to: number }
  | { kind: "server"; to: number | undefined }
  | { kind: "none" };

/**
 * The plan for a part (`part`: its language, or null for the shared part),
 * from its versions newest first and the version number its current approval
 * was given for (null where it has none).
 *
 * A language's version under review is its own newest. The shared part's is
 * the document's newest in any language, as the server's review reads it:
 * every language's version carries the shared fields.
 *
 * Its comparison is always the server's, which reads the approval the part
 * was last given even where an edit withdrew it since (the review state then
 * says no approval, and the server still keeps what was approved), and what
 * is published where it was never approved.
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
  const newest =
    part === null
      ? saved[0]
      : saved.find(version => (version.locale ?? null) === part);
  if (
    newest !== undefined &&
    approvedVersionNo !== null &&
    approvedVersionNo >= newest.versionNo
  ) {
    return { kind: "unchanged", to: newest.versionNo };
  }
  return { kind: "server", to: newest?.versionNo };
}
