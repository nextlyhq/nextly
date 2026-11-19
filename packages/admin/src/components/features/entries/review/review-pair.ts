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
 * every language's version carries the shared fields (its comparison is
 * `sharedPlan`'s).
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

/**
 * The shared part's comparison, found in one language's own versions: the
 * history compares within one language, and the shared part's version under
 * review (the document's newest, in any language) carries the shared fields
 * in its own language.
 *
 * Its baseline is that language's newest version numbered at or before the
 * shared part's approved version, or, with none, at or before the document's
 * last published version: never one saved after, so the comparison may show
 * more than the shared fields changed since, never less. Where that language
 * has no such version, the whole version is shown as new.
 */
export type SharedPlan =
  | { kind: "none" }
  | { kind: "unchanged"; to: number }
  | {
      kind: "pair";
      from: number;
      to: number;
      since: "approved" | "published";
      /** The language compared within; null for the shared fields' own rows. */
      within: string | null;
    }
  | { kind: "first"; to: number; within: string | null }
  /** The baseline may be on a later page of the history: read it first. */
  | { kind: "more" };

/**
 * The plan for the shared part, from the document's versions newest first
 * (every language's, as many pages as are read), whether they are all of
 * them (`complete`), and the shared part's current approval.
 */
export function sharedPlan(
  versions: readonly VersionMeta[],
  complete: boolean,
  approval: { versionNo: number; at: string } | null
): SharedPlan {
  const saved = versions.filter(
    (version): version is VersionMeta & { versionNo: number } =>
      version.versionNo !== null && !version.isAutosave
  );
  const newest = saved[0];
  if (newest === undefined) return { kind: "none" };
  const to = newest.versionNo;
  if (approval !== null && approval.versionNo >= to) {
    return { kind: "unchanged", to };
  }
  const within = newest.locale ?? null;
  // Cut off by version number, one sequence per document in every language:
  // two versions saved in the same second share a time, and a cut by time
  // could take a draft saved after the publish as the baseline, leaving out
  // the change it made.
  const cutoff =
    approval?.versionNo ??
    saved.find(version => version.status === "published")?.versionNo;
  const baseline =
    cutoff === undefined
      ? undefined
      : saved.find(
          version =>
            version.versionNo !== to &&
            (version.locale ?? null) === within &&
            version.versionNo <= cutoff
        );
  if (baseline !== undefined) {
    return {
      kind: "pair",
      from: baseline.versionNo,
      to,
      since: approval === null ? "published" : "approved",
      within,
    };
  }
  return complete ? { kind: "first", to, within } : { kind: "more" };
}
