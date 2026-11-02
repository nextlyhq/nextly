/**
 * The release queries' keys, and how often a release answer is asked again.
 *
 * A module of its own, apart from the release hooks, because the document
 * panel's Publishing section reads which releases hold a document
 * (`useReleasesContaining`), and the panel is reached from the admin's entry:
 * what it imports loads before the first screen of every route. Kept here,
 * that is the keys and the poll timing, not every release hook and the
 * release API with them.
 *
 * @module hooks/queries/release-keys
 */

import type {
  ReleaseCalendarParams,
  ReleaseDocumentRef,
  ReleaseListParams,
} from "@admin/types/releases";

export const releaseKeys = {
  all: () => ["releases"] as const,
  list: (
    params: ReleaseListParams
  ): readonly ["releases", "list", ReleaseListParams] =>
    ["releases", "list", params] as const,
  calendar: (
    params: ReleaseCalendarParams
  ): readonly ["releases", "calendar", ReleaseCalendarParams] =>
    ["releases", "calendar", params] as const,
  everyId: (
    params: ReleaseListParams
  ): readonly ["releases", "every-id", ReleaseListParams] =>
    ["releases", "every-id", params] as const,
  detail: (id: string): readonly ["releases", "detail", string] =>
    ["releases", "detail", id] as const,
  members: (id: string): readonly ["releases", "members", string] =>
    ["releases", "members", id] as const,
  blockers: (id: string): readonly ["releases", "blockers", string] =>
    ["releases", "blockers", id] as const,
  readinessOf: (id: string): readonly ["releases", "readiness", string] =>
    ["releases", "readiness", id] as const,
  history: (id: string): readonly ["releases", "history", string] =>
    ["releases", "history", id] as const,
  created: (id: string): readonly ["releases", "history", string, "created"] =>
    ["releases", "history", id, "created"] as const,
  documents: (
    id: string,
    scopeKind: string,
    scopeSlug: string,
    ids: string
  ): readonly ["releases", "documents", string, string, string, string] =>
    ["releases", "documents", id, scopeKind, scopeSlug, ids] as const,
  /**
   * A MUTATION key, for scheduling one document: every send for it runs under
   * this key, so whether one is still out is read from the mutation cache by
   * the whole page, and not only by the dialog that sent it, which a move to
   * another document and back replaces.
   */
  scheduling: (
    document: ReleaseDocumentRef
  ): readonly ["releases", "scheduling", string, string, string] =>
    [
      "releases",
      "scheduling",
      document.scopeKind,
      document.scopeSlug,
      document.entryId,
    ] as const,
  readiness: (
    ids: readonly string[],
    listReadAt: number
  ): readonly ["release-page-readiness", readonly string[], number] =>
    ["release-page-readiness", [...ids], listReadAt] as const,
};

/**
 * How often to re-ask while a release is still ahead of this document.
 *
 * A minute. The banner is a safety signal rather than a clock, so the cost of
 * being a minute late is that an editor briefly reads a promise that has just
 * become moot; the cost of polling harder is a request per document editor per
 * few seconds, for a page that mostly sits open.
 */
export const PENDING_RELEASE_POLL_MS = 60_000;

/**
 * How often to re-ask when this document is in no release at all.
 *
 * Five minutes. Nearly every document is in this state, so the cost is paid on
 * every open editor — but the answer is not static: somebody else can schedule
 * this document at any moment, and nothing they do reaches this browser.
 */
export const NO_RELEASE_POLL_MS = 300_000;

/** Whether anything in this answer is still waiting to happen. */
export function hasPendingRelease(
  data: { items: { state: string }[] } | undefined
): boolean {
  return (data?.items ?? []).some(release => release.state === "scheduled");
}
