"use client";

/**
 * The releases a document may be added to from its editor: ordinary releases,
 * scheduled or still drafts, that the reader may add a document to.
 *
 * Never a single-document release, which holds the one document it was made
 * for; never a stopped, published or cancelled one, where nothing added would
 * go out; and never an overdue one, which the Upcoming tab leaves to Needs
 * attention, since joining a release already past its moment publishes the
 * document as soon as the runner next runs.
 *
 * @module components/features/releases/useScheduleTargets
 */

import { useReleases } from "@admin/hooks/queries/useReleases";
import type { Release } from "@admin/types/releases";

/** Whether a release is one a document may be added to from its editor. */
function isScheduleTarget(release: Release): boolean {
  return (
    release.kind !== "single" &&
    (release.state === "draft" || release.state === "scheduled") &&
    release.can?.addMember === true
  );
}

/**
 * Asked as two narrow reads rather than one wide one, so drafts, the usual
 * target, are not pushed out of the first page by scheduled and published
 * releases. Not asked until `enabled`: the reads are gated, and a reader who
 * never opens this path should not issue them.
 */
export function useScheduleTargets(
  search: string,
  enabled: boolean
): {
  items: Release[];
  isPending: boolean;
  isError: boolean;
  truncated: boolean;
} {
  const narrowed = search.trim() === "" ? {} : { search: search.trim() };
  const queries = [
    useReleases(
      { tab: "upcoming", kind: "release", limit: 20, ...narrowed },
      enabled
    ),
    useReleases(
      { tab: "drafts", kind: "release", limit: 20, ...narrowed },
      enabled
    ),
  ];
  return {
    // Guarded again over the rows in hand, which costs nothing: whatever the
    // reads were asked, a release of another kind or state is not offered.
    items: queries
      .flatMap(query => query.data?.items ?? [])
      .filter(isScheduleTarget),
    isPending: enabled && queries.some(query => query.isPending),
    isError: queries.some(query => query.isError),
    truncated: queries.some(query => query.data?.meta.hasNext === true),
  };
}
