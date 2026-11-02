/**
 * Why a document stops a release, said once.
 *
 * The schedule dialog lists these while somebody is choosing a moment, and the
 * release page says them beside the document they are on
 * (`release-problems`). One definition per reason, so the two never explain
 * the same failure two different ways.
 *
 * @module components/features/releases/release-blockers
 */
import type { ReleaseBlockerReason } from "@admin/types/releases";

export interface BlockerReasonCopy {
  /** The clause, written to follow the document it is about. */
  summary: string;
}

export const BLOCKER_REASON: Record<ReleaseBlockerReason, BlockerReasonCopy> = {
  AUTHOR_GONE: {
    summary: "the person who added it has been deleted or deactivated",
  },
  NO_AUTHOR: {
    summary: "no author was recorded for it",
  },
  LOCALE_SCOPED: {
    summary: "it names a single language, which a release cannot act on",
  },
};

/** The clause alone, for a list. */
export function blockerSummary(reason: ReleaseBlockerReason): string {
  return BLOCKER_REASON[reason].summary;
}
