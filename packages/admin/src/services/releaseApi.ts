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
  ReleaseListParams,
  ReleaseMember,
  ScheduleReleasePayload,
} from "../types/releases";

/** The canonical list envelope this API returns. */
export interface ReleaseListResponse {
  items: Release[];
  meta: { total: number; hasNext: boolean };
}

export interface MemberListResponse {
  items: ReleaseMember[];
  meta: { total: number; hasNext: boolean };
}

/** The canonical mutation envelope. */
export interface ReleaseMutationResponse {
  item: Release;
}

export interface MemberMutationResponse {
  item: ReleaseMember;
}

function query(params: ReleaseListParams): string {
  const search = new URLSearchParams();
  // Only what was asked for. An empty value would reach the route as a filter
  // it must then refuse — the state parser rejects an unrecognised state rather
  // than widening the query, which is the behaviour we want and not one to
  // trigger by accident.
  if (params.state) search.set("state", params.state);
  if (params.scheduledAfter)
    search.set("scheduledAfter", params.scheduledAfter);
  if (params.scheduledBefore) {
    search.set("scheduledBefore", params.scheduledBefore);
  }
  if (params.limit !== undefined) search.set("limit", String(params.limit));
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
