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
import { collectionKeys } from "@admin/hooks/queries/useCollections";
import { reviewKeys } from "@admin/hooks/queries/useReviewState";
import { singleKeys } from "@admin/hooks/queries/useSingles";
import { waitingKeys } from "@admin/hooks/queries/useWaitingForMe";
import { workflowKeys } from "@admin/hooks/queries/workflow-keys";
import type { ListResponse } from "@admin/lib/api/response-types";
import { entryKeys } from "@admin/services/entryApi";
import {
  getWorkflowSettings,
  listWorkflows,
  updateWorkflowSettings,
} from "@admin/services/workflowApi";
import type {
  WorkflowSettingsChange,
  WorkflowSettingsView,
  WorkflowSummary,
} from "@admin/types/workflows";

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
    // Read again each time the list is opened: its counts per stage move with
    // saves, publishes and other people's steps, none of which pass through
    // this cache.
    refetchOnMount: "always",
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
 * The metadata reads that name a workflow's stages: each collection's and Single's it holds, as
 * `held` (the cached workflows list) names them; every one where the list was not read.
 */
function metadataKeys(
  held: Pick<WorkflowSummary, "collections" | "singles"> | undefined
): (readonly unknown[])[] {
  if (held === undefined) {
    return [
      collectionKeys.details(),
      collectionKeys.schemas(),
      singleKeys.details(),
      singleKeys.schemas(),
    ];
  }
  return [
    ...held.collections.flatMap(name => [
      collectionKeys.detail(name),
      collectionKeys.schema(name),
    ]),
    ...held.singles.flatMap(slug => [
      singleKeys.detail(slug),
      singleKeys.schema(slug),
    ]),
  ];
}

/**
 * Changes one workflow's settings. The answer is the settings as they then
 * read, so it replaces the cached settings at once, with no second read. A
 * change of a stage's label or colour is shown wherever the stage is, so it
 * also marks the workflows list and every document's review state stale: the
 * list, the editor's review card and its status line read the stage again. A
 * change of a default reviewer or of who takes a step changes who each part
 * waits for and which steps a reader may take, so it marks every review state
 * stale; the list shows neither and is kept. Either kind is shown in the waiting
 * view and each list's Review column too, so both are marked stale; a label is
 * also in the metadata of each collection and Single the workflow holds (its
 * stage filter), so theirs are, as the cached workflows list names them, else
 * every collection's and Single's.
 */
export function useUpdateWorkflowSettings(
  slug: string
): UseMutationResult<WorkflowSettingsView, Error, WorkflowSettingsChange> {
  const queryClient = useQueryClient();
  return useMutation<WorkflowSettingsView, Error, WorkflowSettingsChange>({
    mutationFn: change => updateWorkflowSettings(slug, change),
    onSuccess: async (settings, change) => {
      queryClient.setQueryData(workflowKeys.settings(slug), settings);
      const shown = change.labels !== undefined;
      const reviewed =
        shown ||
        change.defaultReviewers !== undefined ||
        change.grants !== undefined;
      // Read before the list is marked stale: which collections and Singles the workflow holds.
      const held = queryClient
        .getQueryData<ListResponse<WorkflowSummary>>(workflowKeys.list())
        ?.items.find(each => each.slug === slug);
      await Promise.all([
        ...(shown
          ? [
              queryClient.invalidateQueries({ queryKey: workflowKeys.list() }),
              ...metadataKeys(held).map(queryKey =>
                queryClient.invalidateQueries({ queryKey })
              ),
            ]
          : []),
        ...(reviewed
          ? [
              queryClient.invalidateQueries({ queryKey: reviewKeys.all() }),
              queryClient.invalidateQueries({ queryKey: waitingKeys.all() }),
              queryClient.invalidateQueries({ queryKey: entryKeys.lists() }),
            ]
          : []),
      ]);
    },
  });
}
