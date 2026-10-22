/**
 * What a release's own page says about the release as a whole: where it
 * stands, when it runs, how ready it is, and how full it is.
 *
 * Plain functions over what the server sent, so each sentence is one a test
 * can hold and the page only lays them out. Times read through
 * `release-time`, so the page says a time exactly as the list does.
 *
 * @module components/features/releases/release-page
 */
import { RELEASE_MEMBER_LIMIT } from "nextly/schemas";

import type { Release, ReleaseReadiness } from "@admin/types/releases";

import {
  describeNeedFix,
  describeReadiness,
  releaseRowStatus,
  summariseReadiness,
  type ReleaseReadinessSummary,
  type ReleaseRowStatus,
} from "./release-list";
import { releaseTimeText, type ReleaseTimeText } from "./release-time";

/**
 * Where a release stands, in the list's words.
 *
 * Read as the Upcoming tab reads it: a release's own read does not say
 * whether it is overdue, and the list's rule for that is the server's, so the
 * page says "Scheduled" with a time already past rather than a second rule.
 */
export function releasePageStatus(
  release: Pick<Release, "state">
): ReleaseRowStatus {
  return releaseRowStatus(release, "upcoming");
}

/** When the release runs or ran, as the header's line says it. */
export interface ReleaseWhenLine {
  /** "Goes live", "Was due", "Went live", or the whole line when no time. */
  lead: string;
  time: ReleaseTimeText | null;
}

/** The header's line about when, for this release in this reader's zone. */
export function releaseWhenLine(
  release: Pick<
    Release,
    "state" | "scheduledAt" | "timezone" | "publishedAt" | "updatedAt"
  >,
  context: { readerZone: string; now: number }
): ReleaseWhenLine {
  const scheduled = (lead: string): ReleaseWhenLine => ({
    lead,
    time: releaseTimeText(release.scheduledAt, {
      ...context,
      scheduledZone: release.timezone,
    }),
  });
  switch (release.state) {
    case "scheduled":
      return scheduled("Goes live");
    case "blocked":
      return scheduled("Was due");
    case "published":
      // When it happened, in the reader's zone alone: a record of when
      // something went out was never promised in another zone.
      return {
        lead: "Went live",
        time: releaseTimeText(
          release.publishedAt ?? release.updatedAt,
          context
        ),
      };
    case "cancelled":
      return { lead: "Cancelled · nothing in it will go live", time: null };
    case "draft":
      return { lead: "Not scheduled yet", time: null };
  }
}

/** What the readiness panel says, and how strongly. */
export interface ReadinessHeadline {
  tone: "ready" | "fix" | "stopped";
  /** "All 6 ready.", "5 of 6 ready." */
  lead: string;
  /** The sentence after it, or `null`. */
  detail: string | null;
  summary: ReleaseReadinessSummary;
}

/**
 * The readiness panel's sentence for a release holding `total` documents,
 * the hidden ones included, from its checks.
 *
 * Only hard problems make a document not ready; the notes are counted beside
 * it. A stopped release says what it needs, since it will not run until
 * someone acts on it.
 */
export function readinessHeadline(
  release: Pick<Release, "state">,
  total: number,
  readiness: Pick<ReleaseReadiness, "hard" | "soft" | "hidden">
): ReadinessHeadline {
  const summary = summariseReadiness(total, readiness);
  const notes =
    new Set(readiness.soft.map(finding => finding.memberId)).size +
    (readiness.hidden ?? []).reduce((count, entry) => count + entry.soft, 0);
  const noteLine =
    notes > 0
      ? `${notes} ${notes === 1 ? "document has a note" : "documents have notes"}, which won't stop it.`
      : null;
  const lead = `${describeReadiness(summary)}.`;
  if (release.state === "blocked") {
    return {
      tone: "stopped",
      lead: "This release stopped and won't run on its own.",
      detail:
        summary.needFix > 0
          ? `${describeNeedFix(summary.needFix)}. Once fixed, schedule it again.`
          : "Nothing is stopping it now. Schedule it again to let it run.",
      summary,
    };
  }
  if (summary.needFix === 0) {
    return { tone: "ready", lead, detail: noteLine, summary };
  }
  return {
    tone: "fix",
    lead,
    detail: `${describeNeedFix(summary.needFix)} before this release can be scheduled or published.`,
    summary,
  };
}

/**
 * What the page says about the member limit, or `null` while there is room.
 *
 * A release at the limit takes no more; one made before the limit and over
 * it still runs and can lose documents, but takes none.
 */
export function memberLimitLine(total: number): string | null {
  if (total > RELEASE_MEMBER_LIMIT) {
    return `This release holds ${total} documents, more than the ${RELEASE_MEMBER_LIMIT} a release may now hold. It still runs, and documents can be taken out, but none can be added.`;
  }
  if (total === RELEASE_MEMBER_LIMIT) {
    return `This release holds its limit of ${RELEASE_MEMBER_LIMIT} documents.`;
  }
  return null;
}

/** Whether a release still has a moment ahead, so its readiness matters. */
export function releaseIsAhead(release: Pick<Release, "state">): boolean {
  return (
    release.state === "draft" ||
    release.state === "scheduled" ||
    release.state === "blocked"
  );
}

/**
 * Why the release cannot be scheduled or published now, or `null` when its
 * checks have answered and nothing stops it. Unknown readiness is not a
 * reason: the server judges again when asked, and refuses then.
 */
export function commitBlockedBy(
  readiness: Pick<ReleaseReadiness, "hard" | "hidden"> | undefined,
  total: number
): string | null {
  if (!readiness) return null;
  const { needFix } = summariseReadiness(total, readiness);
  if (needFix === 0) return null;
  return needFix === 1
    ? "Fix the document marked below first."
    : `Fix the ${needFix} documents marked below first.`;
}
