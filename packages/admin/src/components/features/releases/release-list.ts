/**
 * What the release list says about each release, as plain functions.
 *
 * Kept out of the components so each wording rule is one function a test can
 * hold, and so the cells only lay out what these return.
 *
 * @module components/features/releases/release-list
 */
import type {
  Release,
  ReleaseListTab,
  ReleaseMemberCounts,
  ReleaseReadiness,
} from "@admin/types/releases";

/** Each tab's name, in the reader's words. */
export const RELEASE_TAB_LABEL: Record<ReleaseListTab, string> = {
  upcoming: "Upcoming",
  attention: "Needs attention",
  drafts: "Drafts",
  done: "Done",
};

/**
 * Where a release stands, as the list shows it.
 *
 * One more than the engine's states: an OVERDUE release is `scheduled` to the
 * engine, and that is exactly why it needs its own word here. Read from the tab
 * the row came from rather than from the clock in this browser: the server put
 * it in Needs attention by its own overdue rule, and a second rule here would
 * disagree with it for a few seconds either side of the cutoff.
 */
export type ReleaseRowStatus =
  | "scheduled"
  | "overdue"
  | "stopped"
  | "draft"
  | "published"
  | "cancelled";

export function releaseRowStatus(
  release: Pick<Release, "state">,
  tab: ReleaseListTab
): ReleaseRowStatus {
  switch (release.state) {
    case "scheduled":
      return tab === "attention" ? "overdue" : "scheduled";
    case "blocked":
      // "Stopped" rather than the engine's "blocked": it says what happened to
      // the launch, which is what the person reading the row needs to know.
      return "stopped";
    case "draft":
      return "draft";
    case "published":
      return "published";
    case "cancelled":
      return "cancelled";
  }
}

/** Each row status's label and the badge it is drawn with. */
export const RELEASE_ROW_STATUS: Record<
  ReleaseRowStatus,
  {
    label: string;
    variant:
      | "primary"
      | "warning"
      | "destructive"
      | "outline"
      | "success"
      | "default";
  }
> = {
  scheduled: { label: "Scheduled", variant: "primary" },
  overdue: { label: "Overdue", variant: "warning" },
  stopped: { label: "Stopped", variant: "destructive" },
  // Draft and cancelled are drawn differently on purpose: one is still being
  // assembled, the other was called off, and a reader scanning Done should not
  // have to read the word to tell a cancelled launch from a finished one.
  draft: { label: "Draft", variant: "outline" },
  published: { label: "Published", variant: "success" },
  cancelled: { label: "Cancelled", variant: "default" },
};

/** The heading of the column that says when, for the tab being read. */
export const RELEASE_WHEN_HEADER: Record<ReleaseListTab, string> = {
  upcoming: "Goes live",
  attention: "Was due",
  drafts: "Created",
  done: "Finished",
};

/**
 * The instant a row's "when" column shows.
 *
 * Each tab's own: when it will run, when it was due, when the draft was
 * started, and when it finished. A published release says when it went out;
 * a cancelled one when it was called off, which is when it last changed.
 */
export function releaseWhenInstant(
  release: Pick<
    Release,
    "state" | "scheduledAt" | "publishedAt" | "createdAt" | "updatedAt"
  >,
  tab: ReleaseListTab
): string | null {
  switch (tab) {
    case "upcoming":
    case "attention":
      return release.scheduledAt;
    case "drafts":
      return release.createdAt;
    case "done":
      return release.state === "published"
        ? (release.publishedAt ?? release.updatedAt)
        : release.updatedAt;
  }
}

/** How many of a release's documents go live, and how many come down. */
export type ReleaseActionCounts = Pick<
  ReleaseMemberCounts,
  "goLive" | "comeDown"
>;

/**
 * What a release does, in words: "5 go live, 1 comes down".
 *
 * `ran` puts it in the past for a release that already went out. Empty for a
 * release with no documents, which the cell says in its own words.
 */
export function describeMemberActions(
  counts: ReleaseActionCounts,
  tense: "ahead" | "ran"
): string {
  const parts: string[] = [];
  if (counts.goLive > 0) {
    parts.push(
      tense === "ran"
        ? `${counts.goLive} went live`
        : `${counts.goLive} ${counts.goLive === 1 ? "goes" : "go"} live`
    );
  }
  if (counts.comeDown > 0) {
    parts.push(
      tense === "ran"
        ? `${counts.comeDown} came down`
        : `${counts.comeDown} ${counts.comeDown === 1 ? "comes" : "come"} down`
    );
  }
  return parts.join(", ");
}

/** "1 document", "6 documents". */
export function documentCount(total: number): string {
  return `${total} ${total === 1 ? "document" : "documents"}`;
}

/**
 * A release's documents and what it does with them, as the count and the
 * words that follow it.
 *
 * Where every document does the same thing the action reads straight on from
 * the count, "3 documents go live", rather than counting twice as
 * "3 documents · 3 go live". Only a mixed release breaks it down. Split in two
 * so the count can be drawn in the stronger colour.
 */
export function describeDocuments(
  counts: ReleaseActionCounts,
  tense: "ahead" | "ran"
): { count: string; tail: string } {
  const total = counts.goLive + counts.comeDown;
  const count = documentCount(total);
  if (counts.goLive > 0 && counts.comeDown > 0) {
    return { count, tail: ` · ${describeMemberActions(counts, tense)}` };
  }
  const one = total === 1;
  if (counts.goLive > 0) {
    return {
      count,
      tail: tense === "ran" ? " went live" : one ? " goes live" : " go live",
    };
  }
  if (counts.comeDown > 0) {
    return {
      count,
      tail: tense === "ran" ? " came down" : one ? " comes down" : " come down",
    };
  }
  return { count, tail: "" };
}

/** How many of a release's documents are ready, from its checks. */
export interface ReleaseReadinessSummary {
  total: number;
  ready: number;
  /** Documents with at least one hard problem. */
  needFix: number;
}

/**
 * Count ready documents from a readiness answer.
 *
 * Counted by DOCUMENT, not by finding: one document missing two required
 * fields is one document to fix. Only hard problems make a document not
 * ready; soft ones are notes and never stop a release.
 */
export function summariseReadiness(
  total: number,
  readiness: Pick<ReleaseReadiness, "hard">
): ReleaseReadinessSummary {
  const needFix = Math.min(
    total,
    new Set(readiness.hard.map(finding => finding.memberId)).size
  );
  return { total, ready: total - needFix, needFix };
}

/** "All 3 ready", "5 of 6 ready". */
export function describeReadiness(summary: ReleaseReadinessSummary): string {
  if (summary.needFix === 0) {
    return summary.total === 1 ? "Ready" : `All ${summary.total} ready`;
  }
  return `${summary.ready} of ${summary.total} ready`;
}

/** "1 needs a fix", "2 need a fix". */
export function describeNeedFix(count: number): string {
  return `${count} ${count === 1 ? "needs" : "need"} a fix`;
}

/** Who owns a release, as the owner cell draws them. */
export type ReleaseOwnerView =
  | { kind: "unrecorded" }
  | { kind: "loading" }
  | { kind: "known"; label: string; name: string; image?: string }
  | { kind: "unnamed" };

interface OwnerPerson {
  id: string;
  name: string;
}

/**
 * The owner id worth asking the users list about, if any: not the reader's
 * own, which they already know, and only for a reader who may read users.
 */
export function ownerIdToLookUp({
  ownerId,
  meId,
  canReadUsers,
}: {
  ownerId: string | null;
  meId: string | undefined;
  canReadUsers: boolean;
}): string | undefined {
  if (ownerId === null || ownerId === meId || !canReadUsers) return undefined;
  return ownerId;
}

/**
 * Who owns a release: whoever created it.
 *
 * Named from the users list where the reader may read it, and as "You" for
 * their own. Someone who may not read users is told only that it is another
 * person's: the release carries an id, and an id is not a name.
 */
export function releaseOwnerView({
  ownerId,
  me,
  canReadUsers,
  lookup,
}: {
  ownerId: string | null;
  me: (OwnerPerson & { avatar?: string }) | null;
  canReadUsers: boolean;
  lookup: { pending: boolean; user?: OwnerPerson & { image?: string } };
}): ReleaseOwnerView {
  if (ownerId === null) return { kind: "unrecorded" };
  if (me && ownerId === me.id) {
    return { kind: "known", label: "You", name: me.name, image: me.avatar };
  }
  if (!canReadUsers) return { kind: "unnamed" };
  if (lookup.pending) return { kind: "loading" };
  return lookup.user ? namedOwner(lookup.user) : { kind: "unnamed" };
}

function namedOwner(user: OwnerPerson & { image?: string }): ReleaseOwnerView {
  return {
    kind: "known",
    label: user.name,
    name: user.name,
    image: user.image,
  };
}
