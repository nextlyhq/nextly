/**
 * The registered workflows and one workflow's settings, for Settings ›
 * Workflows.
 *
 * Query keys:
 * - `["workflows", "list"]`: every registered workflow
 * - `["workflows", "settings", slug]`: one workflow's settings
 *
 * @module hooks/queries/useWorkflows
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuthSession } from "@admin/hooks/queries/useAuthSession";
import type { ListResponse } from "@admin/lib/api/response-types";
import {
  getWorkflowSettings,
  listWorkflows,
  updateWorkflowSettings,
} from "@admin/services/workflowsApi";
import type {
  WorkflowSettingsChange,
  WorkflowSettingsView,
  WorkflowSummary,
} from "@admin/types/workflows";

export const workflowKeys = {
  all: () => ["workflows"] as const,
  list: () => [...workflowKeys.all(), "list"] as const,
  settings: (slug: string) =>
    [...workflowKeys.all(), "settings", slug] as const,
};

/**
 * Every registered workflow. Asked only of a signed-in session, as the general
 * settings are: the route answers a visitor 401, and a refused query is asked
 * again by every reader that mounts after it.
 */
export function useWorkflows(): UseQueryResult<
  ListResponse<WorkflowSummary>,
  Error
> {
  const { data: session } = useAuthSession();
  return useQuery<ListResponse<WorkflowSummary>, Error>({
    queryKey: workflowKeys.list(),
    queryFn: listWorkflows,
    enabled: session?.isAuthenticated === true,
  });
}

/** One workflow's settings, once the session is known to be signed in. */
export function useWorkflowSettings(
  slug: string
): UseQueryResult<WorkflowSettingsView, Error> {
  const { data: session } = useAuthSession();
  return useQuery<WorkflowSettingsView, Error>({
    queryKey: workflowKeys.settings(slug),
    queryFn: () => getWorkflowSettings(slug),
    enabled: session?.isAuthenticated === true,
  });
}

/**
 * Changes one workflow's settings. The answer is the settings as they then
 * read, so it replaces the cached settings at once, with no second read.
 */
export function useUpdateWorkflowSettings(
  slug: string
): UseMutationResult<WorkflowSettingsView, Error, WorkflowSettingsChange> {
  const queryClient = useQueryClient();
  return useMutation<WorkflowSettingsView, Error, WorkflowSettingsChange>({
    mutationFn: change => updateWorkflowSettings(slug, change),
    onSuccess: settings => {
      queryClient.setQueryData(workflowKeys.settings(slug), settings);
    },
  });
}
