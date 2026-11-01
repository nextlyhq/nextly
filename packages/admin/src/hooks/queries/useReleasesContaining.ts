"use client";

/**
 * Which scheduled releases hold one document.
 *
 * Apart from the other release hooks because the document panel's Publishing
 * section asks it, and the panel is reached from the admin's entry, so what it
 * imports loads before the first screen of every route: this hook and the
 * release API, not every release hook with them.
 *
 * @module hooks/queries/useReleasesContaining
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import {
  fetchReleases,
  type ReleaseListResponse,
} from "@admin/services/releaseApi";
import type {
  ReleaseDocumentRef,
  ReleaseListParams,
} from "@admin/types/releases";

import {
  hasPendingRelease,
  NO_RELEASE_POLL_MS,
  PENDING_RELEASE_POLL_MS,
  releaseKeys,
} from "./release-keys";

/**
 * The scheduled releases holding one document, soonest first.
 *
 * A narrowing of the same list, so it shares the list's cache key and is
 * invalidated by every release write — adding this document to a release
 * refreshes the banner without the banner knowing that happened.
 */
export function useReleasesContaining(
  document: ReleaseDocumentRef | undefined,
  enabled = true
): UseQueryResult<ReleaseListResponse, Error> {
  // The route's ceiling rather than its default of 50. A document in more
  // than fifty scheduled releases is implausible, and asking for the ceiling
  // costs nothing when the real answer is one or two — but the banner presents
  // the rows as a SEQUENCE whose last member is the document's final state, and
  // a silently truncated sequence would present an incomplete answer as a
  // complete one.
  const params: ReleaseListParams = document
    ? { containing: document, limit: 200 }
    : {};
  const query = useQuery({
    queryKey: releaseKeys.list(params),
    queryFn: () => fetchReleases(params),
    // Never asked without a complete reference: the route refuses a partial
    // one, and a 404-shaped error in the console under every document editor
    // is a poor way to say "this document has no id yet".
    enabled: enabled && Boolean(document),
    // Re-asked on TWO schedules, because two different things change this
    // answer and neither runs an admin mutation that would invalidate it.
    //
    // A pending release is resolved by the background drain, so an editor
    // holding the page across the instant would otherwise keep reading that a
    // release is coming, and that saves are still included, after it has run.
    //
    // An EMPTY answer changes too, and that is the case a pending-only interval
    // misses: another administrator schedules this document from their own
    // browser, which invalidates their QueryClient and not this one. The first
    // editor then goes on saving, indefinitely, without learning the document
    // has an automatic pending change. Polled more slowly rather than not at
    // all — nearly every document is in no release, and the answer is worth one
    // request every few minutes rather than one a minute.
    refetchInterval: data =>
      hasPendingRelease(data.state.data)
        ? PENDING_RELEASE_POLL_MS
        : NO_RELEASE_POLL_MS,
    // And on return to the tab, which is when an editor actually resumes
    // typing. The global provider disables this everywhere; here the answer is
    // a safety signal rather than a view of data the reader already has, and
    // coming back to a stale one is exactly the moment it matters.
    refetchOnWindowFocus: true,
  });
  return query;
}
