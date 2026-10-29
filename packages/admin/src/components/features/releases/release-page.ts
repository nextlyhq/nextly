/**
 * What a release's own page says about the release as a whole: where it
 * stands, when it runs, and how ready it is.
 *
 * Plain functions over what the server sent, so each sentence is one a test
 * can hold and the page only lays them out. Times read through
 * `release-time`, so the page says a time exactly as the list does.
 *
 * @module components/features/releases/release-page
 */
import type { Release, ReleaseReadiness } from "@admin/types/releases";

import {
  describeNeedFix,
  describeReadiness,
  summariseReadiness,
  type ReleaseReadinessSummary,
  type ReleaseRowStatus,
} from "./release-list";
import { releaseTimeText, type ReleaseTimeText } from "./release-time";

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
  context: { readerZone: string; now: number },
  /** Where it stands, when known: an overdue release was due, not upcoming. */
  status?: ReleaseRowStatus | null
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
      return scheduled(status === "overdue" ? "Was due" : "Goes live");
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

/** Whether a release still has a moment ahead, so its readiness matters. */
export function releaseIsAhead(release: Pick<Release, "state">): boolean {
  return (
    release.state === "draft" ||
    release.state === "scheduled" ||
    release.state === "blocked"
  );
}

/** What the page knows of the checks, as `commitBlockedBy` reads it. */
export interface ReadinessRead {
  data: Pick<ReleaseReadiness, "hard" | "hidden"> | undefined;
  isPending: boolean;
  isError: boolean;
}

/** "1 more needs someone who can view it", "2 more need … them". */
function forSomeoneWhoCanView(count: number, lead: string): string {
  return count === 1
    ? `${lead} needs someone who can view it`
    : `${lead} need someone who can view them`;
}

/**
 * Why Schedule and Publish now wait, or `null` when they need not.
 *
 * They wait while the checks are read ("Checking…"), and while a document
 * needs a fix, asking the reader to fix only the documents they can see: one
 * they cannot see needs someone who can. A failed read is not a reason: the
 * server judges again when either is used, and the page says the check
 * failed rather than locking the reader out.
 */
export function commitBlockedBy(
  readiness: ReadinessRead,
  total: number
): string | null {
  const { data } = readiness;
  if (data === undefined) {
    return readiness.isPending && !readiness.isError ? "Checking…" : null;
  }
  const { needFix } = summariseReadiness(total, data);
  if (needFix === 0) return null;
  const hidden = Math.min(
    needFix,
    (data.hidden ?? []).reduce((count, entry) => count + entry.hard, 0)
  );
  const visible = needFix - hidden;
  if (visible === 0) {
    return `${forSomeoneWhoCanView(hidden, `${hidden} ${hidden === 1 ? "document" : "documents"}`)}.`;
  }
  const fix =
    visible === 1
      ? "Fix the document marked below first"
      : hidden > 0
        ? "Fix the documents marked below first"
        : `Fix the ${visible} documents marked below first`;
  return hidden === 0
    ? `${fix}.`
    : `${fix}; ${forSomeoneWhoCanView(hidden, `${hidden} more`)}.`;
}
