/**
 * The admin's client for `/api/releases`.
 *
 * Thin over `fetcher`, like every other service here. The route enforces the
 * three release permissions and refuses generically — `NextlyError.forbidden`
 * ships one fixed sentence so a response cannot leak the shape of the authority
 * model — so this layer does not try to interpret a refusal. The screens above
 * it decide what to OFFER, which is the better answer anyway: not showing an
 * action somebody cannot take beats explaining the refusal afterwards.
 *
 * @module services/releaseApi
 */

import { fetcher } from "../lib/api/fetcher";
import type {
  AddReleaseMemberPayload,
  CreateReleasePayload,
  Release,
  ReleaseBlocker,
  ReleaseListParams,
  ReleaseMember,
  ReleaseReadinessEntry,
  ScheduleReleasePayload,
} from "../types/releases";

/**
 * The canonical list envelope this API returns.
 *
 * `total` is every release the query matches, not the rows on this page, so a
 * pager built on it reaches every page. The paging fields are optional because
 * a `containing` read is answered by the same envelope and a caller of that one
 * reads only `total` and `hasNext`.
 */
export interface ReleaseListResponse {
  items: Release[];
  meta: {
    total: number;
    hasNext: boolean;
    page?: number;
    limit?: number;
    totalPages?: number;
    hasPrev?: boolean;
  };
}

export interface MemberListResponse {
  items: ReleaseMember[];
  meta: { total: number; hasNext: boolean };
}

/** The blockers standing between one release and its instant. */
export interface BlockerListResponse {
  items: ReleaseBlocker[];
  meta: { total: number; hasNext: boolean };
}

/** The canonical mutation envelope. */
export interface ReleaseMutationResponse {
  /** The server's sentence for what happened, where it says more than "done". */
  message?: string;
  item: Release;
}

export interface MemberMutationResponse {
  item: ReleaseMember;
}

/**
 * The list parameters that travel as they are, under their own names.
 *
 * Only what was asked for is sent. An empty value would reach the route as a
 * filter it must then refuse — the state parser rejects an unrecognised state
 * rather than widening the query, which is the behaviour we want and not one
 * to trigger by accident.
 */
const PLAIN_LIST_PARAMS = [
  "state",
  "scheduledAfter",
  "scheduledBefore",
  "limit",
  "page",
  "tab",
  "reason",
  "kind",
] as const satisfies ReadonlyArray<keyof ReleaseListParams>;

function query(params: ReleaseListParams): string {
  const search = new URLSearchParams();
  for (const key of PLAIN_LIST_PARAMS) {
    const value = params[key];
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  // Trimmed here only to decide whether to send it: an all-space search is no
  // search, and sending it would match every title that has a space in it.
  // The server trims and bounds what it is sent, so the text goes as typed.
  if (params.search?.trim()) search.set("search", params.search);
  // All three or none. The route refuses a partial reference, so sending one
  // part would turn a document question into a 400 rather than into an answer
  // about every release.
  if (params.containing) {
    search.set("containingScopeKind", params.containing.scopeKind);
    search.set("containingScopeSlug", params.containing.scopeSlug);
    search.set("containingEntryId", params.containing.entryId);
  }
  const q = search.toString();
  return q ? `?${q}` : "";
}

export const fetchReleases = (
  params: ReleaseListParams = {}
): Promise<ReleaseListResponse> =>
  fetcher<ReleaseListResponse>(`/releases${query(params)}`, {}, true);

export const fetchRelease = (id: string): Promise<Release> =>
  fetcher<Release>(`/releases/${id}`, {}, true);

export const fetchReleaseMembers = (
  releaseId: string
): Promise<MemberListResponse> =>
  fetcher<MemberListResponse>(`/releases/${releaseId}/members`, {}, true);

/**
 * What stands between a release and its instant, asked before committing.
 *
 * Its own request rather than a field on the detail read: answering it costs an
 * identity lookup over every member, which the detail must not pay to tell the
 * overwhelming majority of callers that nothing is wrong.
 */
export const fetchReleaseBlockers = (
  releaseId: string
): Promise<BlockerListResponse> =>
  fetcher<BlockerListResponse>(`/releases/${releaseId}/blockers`, {}, true);

/** The batch readiness read's envelope. */
export interface ReleaseReadinessListResponse {
  items: ReleaseReadinessEntry[];
  meta: { total: number };
}

/**
 * What the checks say about each of a page of releases, in one request.
 *
 * The server checks every document of each release named, so this is asked
 * only for the releases a screen is showing, and never for more than a page.
 */
export const fetchReleasesReadiness = (
  releaseIds: readonly string[]
): Promise<ReleaseReadinessListResponse> =>
  fetcher<ReleaseReadinessListResponse>(
    `/releases/readiness?ids=${releaseIds.map(encodeURIComponent).join(",")}`,
    {},
    true
  );

export const createRelease = (
  payload: CreateReleasePayload
): Promise<ReleaseMutationResponse> =>
  fetcher<ReleaseMutationResponse>(
    "/releases",
    { method: "POST", body: JSON.stringify(payload) },
    true
  );

export const addReleaseMember = (
  releaseId: string,
  payload: AddReleaseMemberPayload
): Promise<MemberMutationResponse> =>
  fetcher<MemberMutationResponse>(
    `/releases/${releaseId}/members`,
    { method: "POST", body: JSON.stringify(payload) },
    true
  );

/**
 * Remove one document from a release.
 *
 * The release id travels in the PATH and is not decoration: the server refuses
 * a member that belongs to a different release, so a stale link cannot quietly
 * edit a release the editor never opened.
 */
export const removeReleaseMember = (
  releaseId: string,
  memberId: string
): Promise<{ message: string }> =>
  fetcher<{ message: string }>(
    `/releases/${releaseId}/members/${memberId}`,
    { method: "DELETE" },
    true
  );

export const scheduleRelease = (
  id: string,
  payload: ScheduleReleasePayload
): Promise<{ message: string }> =>
  fetcher<{ message: string }>(
    `/releases/${id}/schedule`,
    { method: "POST", body: JSON.stringify(payload) },
    true
  );

export const cancelRelease = (id: string): Promise<{ message: string }> =>
  fetcher<{ message: string }>(
    `/releases/${id}/cancel`,
    { method: "POST", body: JSON.stringify({}) },
    true
  );

/**
 * Run a release now, rather than at its instant.
 *
 * Its own operation on the server, not a schedule for a past instant: the
 * answer says how the run went, which a schedule cannot.
 */
export const publishReleaseNow = (
  id: string
): Promise<ReleaseMutationResponse> =>
  fetcher<ReleaseMutationResponse>(
    `/releases/${id}/publish`,
    { method: "POST", body: JSON.stringify({}) },
    true
  );

/**
 * Delete a draft, or a cancelled release that was never scheduled.
 *
 * The server decides which releases may go, and answers with the release as it
 * was, so the screen can name what it removed.
 */
export const deleteRelease = (id: string): Promise<ReleaseMutationResponse> =>
  fetcher<ReleaseMutationResponse>(
    `/releases/${id}`,
    { method: "DELETE" },
    true
  );
