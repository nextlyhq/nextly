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

/**
 * The release lifecycle, in order.
 *
 * Four states and no more. Sanity offers a release "type" — ASAP, at time,
 * undecided — which reads well but has no counterpart in this engine, and a UI
 * vocabulary the server cannot answer to is a UI that eventually lies.
 */
export const RELEASE_STATES = [
  "draft",
  "scheduled",
  "published",
  "cancelled",
] as const;

export type ReleaseState = (typeof RELEASE_STATES)[number];

/** What a member does to its document when the release takes effect. */
export type ReleaseMemberAction = "publish" | "unpublish";

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

/** The window a release list may be narrowed to. */
export interface ReleaseListParams {
  state?: ReleaseState;
  scheduledAfter?: string;
  scheduledBefore?: string;
  limit?: number;
}
