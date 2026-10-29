/**
 * What the admin knows about a content release.
 *
 * Mirrors the server's row rather than restating it in the admin's own words:
 * `state`, `scheduledAt` and `timezone` are the engine's vocabulary, and a
 * second spelling of them here is how a screen starts describing a state the
 * server does not have.
 *
 * @module types/releases
 */

import type {
  ReleaseBlockerReason,
  ReleaseCapabilities,
  ReleaseKind,
  ReleaseMemberAction,
  ReleaseState,
} from "nextly/schemas";

/**
 * The release lifecycle and the member actions, taken from the engine.
 *
 * Re-exported rather than restated. A second tuple here would compile happily
 * after the server gained a fifth state, and every screen that switches on the
 * state would silently render nothing for it — the failure would appear as a
 * blank cell, not as a type error. `import type` erases at build time, so this
 * costs the admin bundle nothing.
 *
 * Sanity offers a release "type" — ASAP, at time, undecided — which reads well
 * but has no counterpart in this engine, and a UI vocabulary the server cannot
 * answer to is a UI that eventually lies. Deriving from the engine is what makes
 * inventing one impossible rather than merely discouraged.
 */
export type {
  ReleaseBlockerReason,
  ReleaseKind,
  ReleaseMemberAction,
  ReleaseState,
};

/**
 * What the server says THIS reader may do to a release.
 *
 * Sent with the release rather than worked out here. Two halves decide it — the
 * release's state and the caller's authority — and the admin holds only the
 * first: a scoped API key is judged by its own grants, so any rule written here
 * would be guessing at the half it cannot see. Restating the transition rules
 * would also make them a second implementation of the fence the repository
 * enforces with, which is how a screen comes to offer a move the database
 * refuses, or to hide one it allows.
 *
 * Payload computes the same thing per document for its edit view; Sanity gates
 * each release action by its own permission id, so scheduling can be granted
 * without publishing.
 *
 * `addMember` and `removeMember` are NECESSARY rather than sufficient — putting
 * a particular document in also needs that document's own publish authority,
 * which the server checks at the write. They say what to OFFER.
 *
 * The server's own type, re-exported from `nextly/schemas` rather than
 * restated, so a capability the server starts sending is one this type
 * already has.
 */
export type { ReleaseCapabilities };

export interface Release {
  id: string;
  title: string;
  description: string | null;
  /**
   * The instant this release takes effect, as an ISO string over the wire.
   *
   * `null` while a release is still being assembled. Kept as the instant rather
   * than a formatted string so the admin can render it in the reader's own zone
   * AND state the author's, which are different questions.
   */
  scheduledAt: string | null;
  /**
   * The zone the author chose, beside the instant rather than folded into it.
   *
   * "9am Berlin" survives a daylight-saving boundary as a statement where a UTC
   * instant alone does not, and an editor reading "what ships Friday" needs the
   * intent, not only the moment.
   */
  timezone: string | null;
  state: ReleaseState;
  /**
   * `single` for a document scheduled on its own, a release that holds that
   * one document and nothing else.
   *
   * Optional because a release read from somewhere other than the list or
   * detail route may not carry it; a screen marks only an explicit `single`,
   * so an absent kind reads as an ordinary release rather than guessing from
   * the member count, which can change.
   */
  kind?: ReleaseKind;
  /**
   * How many documents it holds, and how many it puts live and takes down.
   *
   * Sent on the release list only, read for the whole page at once. Optional
   * because a release read anywhere else does not carry it, and a screen has
   * to say "unknown" rather than read an absent count as none.
   */
  memberCounts?: ReleaseMemberCounts;
  /**
   * Who owns it, by name only, as the release list names it. `null` for an
   * owner who cannot be named (deleted, or a lookup that failed), while
   * `createdBy` still says one was recorded. Absent off the list.
   */
  owner?: { id: string; name: string | null } | null;
  publishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Absent on a release that came from somewhere other than `/api/releases`.
   *
   * Optional rather than defaulted, so a screen has to decide what to do with
   * "unknown" instead of silently reading it as "not permitted" — which would
   * hide every control — or as permitted, which would offer refusals.
   */
  can?: ReleaseCapabilities;
  /**
   * What this release will do to the document the list was filtered BY.
   *
   * Present only on a read narrowed with `containing`, because it belongs to
   * the membership rather than to the release: one release can publish a post
   * while taking a landing page down. Optional rather than defaulted, so a
   * screen has to decide what an unknown action means instead of quietly
   * calling it a publish.
   */
  memberAction?: ReleaseMemberAction;
  /**
   * What stands between this release and its instant, per member.
   *
   * Sent only on a detail read of a BLOCKED release, and derived there rather
   * than recorded when the drain stopped — so it stops naming a cause somebody
   * has already fixed, instead of telling an operator their repair did nothing.
   */
  blockedBy?: ReleaseBlocker[];
  /**
   * Blocked documents the reader may not read, counted by collection. Sent
   * beside `blockedBy` only when there are any.
   */
  hiddenBlockers?: HiddenReleaseMembers[];
}

/**
 * Documents in a release the reader may not read, counted by the collection
 * or Single they are in. All the server says about them: how many, and where.
 */
export interface HiddenReleaseMembers {
  scopeKind: "collection" | "single" | "page";
  scopeSlug: string;
  count: number;
  /**
   * The collection's display names, sent because a reader who may not read
   * it cannot look them up. Absent for one no longer registered.
   */
  labels?: { singular: string; plural: string };
}

/**
 * The problems of documents the reader may not read, counted by collection:
 * how many documents, and how many of them have a hard or a soft problem.
 */
export interface HiddenReleaseProblems extends HiddenReleaseMembers {
  hard: number;
  soft: number;
}

/**
 * One member standing between a release and its instant.
 *
 * The reason union is taken from the engine, not restated: a cause added there
 * would otherwise compile everywhere and render as `undefined` in the one
 * screen that maps it to a sentence.
 */
export interface ReleaseBlocker {
  memberId: string;
  reason: ReleaseBlockerReason;
  /** What this member was going to do — a blocked takedown is not a failed publish. */
  action: ReleaseMemberAction;
  scopeKind: "collection" | "single" | "page";
  scopeSlug: string;
  entryId: string;
}

export interface ReleaseMember {
  id: string;
  releaseId: string;
  scopeKind: "collection" | "single";
  scopeSlug: string;
  entryId: string;
  /** Always `null` today: per-locale releases are refused at the write surface. */
  locale: string | null;
  action: ReleaseMemberAction;
  createdBy: string | null;
  createdAt: string;
}

export interface CreateReleasePayload {
  title: string;
  description?: string | null;
}

export interface ScheduleReleasePayload {
  /** ISO 8601 with an explicit offset or `Z`; the route refuses anything else. */
  at: string;
  /** An IANA zone name. The route validates it through `Intl`. */
  timezone: string;
}

export interface AddReleaseMemberPayload {
  scopeKind: "collection" | "single";
  scopeSlug: string;
  entryId: string;
  action: ReleaseMemberAction;
}

/** A document, as the release list's `containing` filter names it. */
export interface ReleaseDocumentRef {
  scopeKind: "collection" | "single";
  scopeSlug: string;
  entryId: string;
}

/**
 * The four views of the release list, in the order the list shows them.
 *
 * The server's `?tab=` vocabulary. Spelled here because the server keeps it in
 * its releases domain rather than in `nextly/schemas`, so there is no type to
 * import; a tab the server stopped knowing is refused there with a 400 rather
 * than answered with an empty list, so a drift here surfaces as an error on the
 * screen and never as a tab that silently shows nothing.
 */
export const RELEASE_LIST_TABS = [
  "upcoming",
  "attention",
  "drafts",
  "done",
] as const;

export type ReleaseListTab = (typeof RELEASE_LIST_TABS)[number];

/** Why a release is in Needs attention: it stopped, or it is overdue. */
export type ReleaseAttentionReason = "stopped" | "overdue";

/** The window a release list may be narrowed to. */
export interface ReleaseListParams {
  state?: ReleaseState;
  scheduledAfter?: string;
  scheduledBefore?: string;
  limit?: number;
  /** 1-based, as the route counts pages. */
  page?: number;
  /** One of the list's tabs, ordered as that tab is. */
  tab?: ReleaseListTab;
  /** Narrows Needs attention to one of its two parts. */
  reason?: ReleaseAttentionReason;
  /** Matched against title and description, on the server, before paging. */
  search?: string;
  /**
   * Only releases of this kind. `release` is how the list hides
   * single-document releases.
   */
  kind?: ReleaseKind;
  /**
   * Only the SCHEDULED releases holding this document.
   *
   * The question a document editor asks. All three parts travel or none: the
   * route refuses a partial reference rather than widening to every release,
   * because a banner rendering that would tell an author their post is in
   * eleven launches.
   */
  containing?: ReleaseDocumentRef;
  /**
   * Only the releases a calendar in `timezone` shows on `date`, in every
   * state, soonest first: the day's complete list, paged like the rest. The
   * server places a published release on the day it went out and any other
   * on the day it is scheduled for, the same rule its calendar read uses, so
   * a day's list holds exactly what the day's count counted.
   */
  day?: ReleaseDayFilter;
}

/** One day in a named zone: `date` is `YYYY-MM-DD`, `timezone` an IANA zone. */
export interface ReleaseDayFilter {
  date: string;
  timezone: string;
}

/** How many releases a day holds in each state, every state present. */
export type ReleaseStateCounts = Record<ReleaseState, number>;

/**
 * One day of the server's calendar read.
 *
 * `total` and `counts` cover every release on the day; `releases` holds the
 * first few in time order (the server sends at most three), so "+N more" is
 * worked out from `total` and is complete however busy the day is.
 */
export interface ReleaseCalendarDay {
  date: string;
  total: number;
  counts: ReleaseStateCounts;
  releases: Release[];
}

/** The server's calendar read: every day of the window asked for, in order. */
export interface ReleaseCalendarRead {
  timezone: string;
  from: string;
  to: string;
  days: ReleaseCalendarDay[];
}

/** What a calendar read asks for: a window of at most six weeks, in a zone. */
export interface ReleaseCalendarParams {
  /** The first day, `YYYY-MM-DD`. */
  from: string;
  /** The last day, included. */
  to: string;
  /** The IANA zone the days are read in. */
  timezone: string;
}

/** How many documents a release holds, and what it does with them. */
export interface ReleaseMemberCounts {
  total: number;
  /** Documents the release puts live. */
  goLive: number;
  /** Documents the release takes down. */
  comeDown: number;
}

/**
 * One problem the checks found with one document of a release.
 *
 * `memberId` is what the list counts by: a document can carry several
 * findings, and it is one document that needs fixing, not several.
 */
export interface ReleaseReadinessFinding {
  memberId: string;
  code: string;
  source: string;
  action: ReleaseMemberAction;
  scopeKind: "collection" | "single" | "page";
  scopeSlug: string;
  entryId: string;
  detail?: Readonly<Record<string, string | null | readonly string[]>>;
}

/**
 * What the checks say about a release's documents right now.
 *
 * `hard` problems stop it from being scheduled or published now; `soft` ones
 * are notes. Worked out by the server on each read, so a problem somebody
 * fixed reads as fixed on the next one.
 */
export interface ReleaseReadiness {
  releaseId: string;
  hard: ReleaseReadinessFinding[];
  soft: ReleaseReadinessFinding[];
  /**
   * The documents the reader may not read, with their problems counted by
   * collection rather than named. Absent from a server that does not narrow
   * by reader.
   */
  hidden?: HiddenReleaseProblems[];
}

/**
 * One release's readiness, as the batch read answers it for a page.
 *
 * `checked: false` for a release holding more documents than a release may
 * now hold: the batch leaves those to the release's own page, which checks
 * them in full.
 */
export type ReleaseReadinessEntry =
  | (ReleaseReadiness & { checked: true })
  | { releaseId: string; checked: false; reason: "over-member-limit" };

/** A rename, a new description, or both; `null` clears the description. */
export interface UpdateReleasePayload {
  title?: string;
  description?: string | null;
}

/**
 * The document a release's member names, as its page shows it: what it is
 * called, and where it stands now.
 *
 * Read for the documents the reader may read, which are the only ones the
 * members list names. A member the read does not answer for has no entry: a
 * document deleted since it was added, whose own check then says so.
 */
export interface ReleaseDocumentInfo {
  /** What the document is called, or `null` when nothing in it names it. */
  title: string | null;
  /** Its status now, where its collection has one. */
  status: "draft" | "published" | null;
  /** Whether it has ever been published, where that is recorded. */
  everPublished: boolean | null;
  /** When it was last saved, where that is recorded. */
  updatedAt: string | null;
}

/** A collection's or Single's display names, as the release page groups by them. */
export interface ReleaseScopeNames {
  singular: string;
  plural: string;
}
