/**
 * Why a document stops a release, said once.
 *
 * Two surfaces need this vocabulary and they need different lengths of it: the
 * schedule dialog lists documents while somebody is choosing a moment, so it
 * wants the clause; the stopped-release notice is read while repairing a
 * failure, so it wants the clause AND what to do about it.
 *
 * Held as one definition per reason rather than two maps. Two maps of one
 * vocabulary agree until somebody corrects a wording on the screen they
 * happened to be looking at, and then the product explains the same failure two
 * different ways — with nothing to say which is current.
 *
 * @module components/features/releases/release-blockers
 */
import type { ReleaseBlockerReason } from "@admin/types/releases";

export interface BlockerReasonCopy {
  /** The clause, for a list read while choosing a date. */
  summary: string;
  /**
   * What follows it when there is room to say more — the consequence and the
   * remedy. Written to continue the summary rather than to stand alone, so the
   * two cannot drift into disagreeing about the cause.
   */
  detail: string;
}

export const BLOCKER_REASON: Record<ReleaseBlockerReason, BlockerReasonCopy> = {
  AUTHOR_GONE: {
    summary: "the person who added it has been deleted or deactivated",
    detail:
      ". A release acts on each document as its author, so there is nobody left to act as. Restore that user, or remove the document and add it again.",
  },
  NO_AUTHOR: {
    summary: "no author was recorded for it",
    detail:
      ", so there is nobody to act as. Remove the document and add it again.",
  },
  LOCALE_SCOPED: {
    summary: "it names a single language, which a release cannot act on",
    detail: " by itself. Remove it and add the document without a language.",
  },
};

/** The clause alone, for a list. */
export function blockerSummary(reason: ReleaseBlockerReason): string {
  return BLOCKER_REASON[reason].summary;
}

/** The clause and its remedy, for somebody who has to fix it. */
export function blockerExplanation(reason: ReleaseBlockerReason): string {
  const copy = BLOCKER_REASON[reason];
  return `${copy.summary}${copy.detail}`;
}
