/**
 * Which two versions a reviewer compares: the version under review, and what
 * it is judged against.
 *
 * The version under review is the part's newest saved version (an autosave is
 * not one): a language's own newest, never a newer shared-fields row its list
 * also holds; the shared part's, the document's newest in any language. It is
 * compared with the part's last approval where it has one, so a reviewer sees
 * only what changed since they, or a colleague, approved it; else with what is
 * published of the part, which the server resolves from the part's whole
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

/** A comparison the server resolves from the part's whole history, by a baseline's name. */
export type ServerBaseline = "published" | "since-approved";

/**
 * How a part's pair is found: from its approval, which the list answers for a
 * language, or from a baseline the server resolves for the version under
 * review (`to`; absent where the list's page holds none of the part's own
 * versions, and the server takes the part's newest).
 */
export type ReviewPlan =
  | { kind: "approved"; from: number; to: number }
  | { kind: "unchanged"; to: number }
  | {
      kind: "server";
      baseline: ServerBaseline;
      to: number | undefined;
      since: "approved" | "published";
    }
  | { kind: "none" };

/**
 * The plan for a part (`part`: its language, or null for the shared part),
 * from its versions newest first and the version number its last approval
 * was given for (null where it has none).
 *
 * A language's version under review is its own newest. The shared part's is
 * the document's newest in any language, as the server's review reads it:
 * every language's version carries the shared fields. Its comparison is
 * resolved by the server in the part that newest version belongs to (the
 * history compares within one language), from its approval where it has one,
 * else from what is published.
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
  if (approvedVersionNo === null) {
    return {
      kind: "server",
      baseline: "published",
      to: newest?.versionNo,
      since: "published",
    };
  }
  if (newest === undefined) return { kind: "none" };
  const to = newest.versionNo;
  if (approvedVersionNo >= to) return { kind: "unchanged", to };
  // A language's approval names one of its own versions; the shared part's
  // may name another language's, which only the server pairs within one.
  return part === null
    ? { kind: "server", baseline: "since-approved", to, since: "approved" }
    : { kind: "approved", from: approvedVersionNo, to };
}
