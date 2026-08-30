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

import type { ReleaseMemberAction, ReleaseState } from "nextly/schemas";

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
export type { ReleaseMemberAction, ReleaseState };

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
 */
export interface ReleaseCapabilities {
  schedule: boolean;
  cancel: boolean;
  addMember: boolean;
  removeMember: boolean;
}

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

/** The window a release list may be narrowed to. */
export interface ReleaseListParams {
  state?: ReleaseState;
  scheduledAfter?: string;
  scheduledBefore?: string;
  limit?: number;
  /**
   * Only the SCHEDULED releases holding this document.
   *
   * The question a document editor asks. All three parts travel or none: the
   * route refuses a partial reference rather than widening to every release,
   * because a banner rendering that would tell an author their post is in
   * eleven launches.
   */
  containing?: ReleaseDocumentRef;
}
