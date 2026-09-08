"use client";

/**
 * Background job query hooks.
 *
 * Polled rather than fetched once: this screen is a monitor, and a queue that
 * finishes a job while it is open must not leave a stale row saying the work is
 * still waiting. The interval is deliberately modest and does NOT run while the
 * tab is in the background — TanStack's default for `refetchInterval` — so a
 * forgotten tab costs an installation nothing.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { ListResponse } from "@admin/lib/api/response-types";
import { jobsApi } from "@admin/services/jobsApi";
import type { JobListItem, ListJobsParams } from "@admin/types/jobs";

/** How often an open monitor asks again. */
export const JOBS_POLL_INTERVAL_MS = 15_000;

export const jobKeys = {
  all: () => ["background-jobs"] as const,
  list: (params: ListJobsParams) => [...jobKeys.all(), "list", params] as const,
};

/**
 * The recent-jobs window.
 *
 * `enabled` lets the caller hold the fetch until it knows the viewer may read,
 * so a viewer without the permission never issues a request that can only 403.
 */
export function useJobs(
  params: ListJobsParams = {},
  options?: { enabled?: boolean }
) {
  return useQuery<ListResponse<JobListItem>, Error>({
    queryKey: jobKeys.list(params),
    queryFn: () => jobsApi.listJobs(params),
    enabled: options?.enabled ?? true,
    // Widening the window refetches; keeping the previous rows on screen means
    // the table does not blink empty on a change the reader initiated.
    placeholderData: keepPreviousData,
    refetchInterval: JOBS_POLL_INTERVAL_MS,
    staleTime: JOBS_POLL_INTERVAL_MS,
  });
}
