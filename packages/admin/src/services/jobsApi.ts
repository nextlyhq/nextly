/**
 * Background jobs API service.
 *
 * One read: the most recently touched jobs. There is deliberately no retry,
 * cancel or requeue here — those are writes on already-authorized work and the
 * server does not offer them.
 *
 * Session-or-key read, gated on `manage-background-jobs`. `lastError` carries
 * whatever a handler threw, so the response is private and uncached and its
 * text is delivered exactly as recorded.
 */

import { fetcher } from "../lib/api/fetcher";
import type { ListResponse } from "../lib/api/response-types";
import type { JobListItem, ListJobsParams } from "../types/jobs";

/** Build the query string, omitting an unset limit so the server's default applies. */
function toQuery(params: ListJobsParams): string {
  const search = new URLSearchParams();
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  // A blank slug is "no filter"; only a non-empty value narrows the query.
  if (params.slug) search.set("slug", params.slug);
  if (params.states && params.states.length > 0) {
    search.set("state", params.states.join(","));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/**
 * The most recent jobs, newest activity first.
 *
 * `meta.hasNext` says the window was truncated; the meta carries no true total,
 * because the endpoint has no count to give and a fabricated one would disagree
 * with the rows beside it.
 */
export function listJobs(
  params: ListJobsParams = {}
): Promise<ListResponse<JobListItem>> {
  return fetcher<ListResponse<JobListItem>>(
    `/jobs${toQuery(params)}`,
    {},
    true
  );
}

export const jobsApi = { listJobs };
