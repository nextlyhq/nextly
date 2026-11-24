"use client";

/**
 * A document's review state, and the two writes that move it: taking a step
 * and assigning a part.
 *
 * One query per document, shared by every surface that shows the review (the
 * header's next step, the status line, the side panel and the Languages
 * panel), so they cannot disagree. A document with no workflow attached is
 * answered `{ attached: false }`, not an error, and every surface then draws
 * nothing of its own.
 *
 * @module hooks/queries/useReviewState
 * @experimental
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { entryKeys } from "@admin/services/entryApi";
import {
  assignWorkflowParts,
  fetchReviewState,
  takeWorkflowStep,
  workflowDocument,
  type WorkflowMutationResponse,
} from "@admin/services/workflowApi";
import type { ReleaseDocumentRef } from "@admin/types/releases";
import type {
  AssignmentPayload,
  ReviewStateAnswer,
  TakeStepPayload,
  WorkflowDocumentRef,
} from "@admin/types/workflows";

import { waitingKeys } from "./useWaitingForMe";
import { workflowKeys } from "./workflow-keys";

export const reviewKeys = {
  all: () => ["workflow-review"] as const,
  document: (
    document: ReleaseDocumentRef
  ): readonly ["workflow-review", string, string, string] =>
    [
      "workflow-review",
      document.scopeKind,
      document.scopeSlug,
      // A Single is one document whatever its row's id, as the route names it.
      document.scopeKind === "single" ? "" : document.entryId,
    ] as const,
};

/**
 * The document as the routes name it. Nothing is asked or written before the
 * document exists, so a missing one here is a caller's mistake, refused
 * rather than sent as a request the route would refuse.
 */
function namedDocument(
  document: ReleaseDocumentRef | undefined
): WorkflowDocumentRef {
  if (document === undefined) {
    throw new Error("The document is not saved yet.");
  }
  return workflowDocument(document);
}

/**
 * The review state of one document, or nothing asked before it exists.
 * Asked again on return to the tab: a colleague's step moves it, and no
 * write in this browser would tell this one.
 */
export function useReviewState(
  document: ReleaseDocumentRef | undefined
): UseQueryResult<ReviewStateAnswer, Error> {
  return useQuery({
    queryKey:
      document === undefined
        ? (["workflow-review", "none"] as const)
        : reviewKeys.document(document),
    queryFn: () => fetchReviewState(namedDocument(document)),
    enabled: document !== undefined,
    refetchOnWindowFocus: true,
  });
}

/**
 * What a move of `document` (a step or an assignment) is shown in, marked stale: its review state,
 * the waiting view (who each part waits for, and where it stands), and its collection's lists,
 * whose Review column shows the same. A Single has no list; its review state is all of it.
 */
function refreshAfterMove(
  queryClient: QueryClient,
  document: ReleaseDocumentRef
): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: reviewKeys.document(document),
    }),
    queryClient.invalidateQueries({ queryKey: waitingKeys.all() }),
    ...(document.scopeKind === "collection"
      ? [
          queryClient.invalidateQueries({
            queryKey: entryKeys.listsByCollection(document.scopeSlug),
          }),
        ]
      : []),
  ]);
}

/** A step as the editor asks it, the document named by the hook. */
export type StepRequest = Omit<TakeStepPayload, "document">;

/** Takes one step on the document, then reads its review state again. */
export function useTakeStep(
  document: ReleaseDocumentRef | undefined
): UseMutationResult<WorkflowMutationResponse, Error, StepRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: StepRequest) =>
      takeWorkflowStep({
        document: namedDocument(document),
        ...request,
      }),
    // Read again whether it moved or was refused: a refusal for a stale
    // revision means the state on screen is not the one stored. A step moves
    // the document between stages, so the workflows list's counts per stage
    // are read again too.
    onSettled: async () => {
      if (document === undefined) return;
      await Promise.all([
        refreshAfterMove(queryClient, document),
        queryClient.invalidateQueries({ queryKey: workflowKeys.list() }),
      ]);
    },
  });
}

/** An assignment as the editor asks it, the document named by the hook. */
export type AssignRequest = Omit<AssignmentPayload, "document">;

/** Assigns one part of the document, then reads its review state again. */
export function useAssignPart(
  document: ReleaseDocumentRef | undefined
): UseMutationResult<WorkflowMutationResponse, Error, AssignRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AssignRequest) =>
      assignWorkflowParts([
        {
          document: namedDocument(document),
          ...request,
        },
      ]),
    // An assignment changes who the part waits for, wherever that is shown.
    onSettled: () =>
      document === undefined
        ? undefined
        : refreshAfterMove(queryClient, document),
  });
}
