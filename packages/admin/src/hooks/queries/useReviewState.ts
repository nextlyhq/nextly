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
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

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
} from "@admin/types/workflows";

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
    queryFn: () =>
      fetchReviewState(workflowDocument(document as ReleaseDocumentRef)),
    enabled: document !== undefined,
    refetchOnWindowFocus: true,
  });
}

/** A step as the editor asks it, the document named by the hook. */
export type StepRequest = Omit<TakeStepPayload, "document">;

/** Takes one step on the document, then reads its review state again. */
export function useTakeStep(
  document: ReleaseDocumentRef | undefined
): UseMutationResult<WorkflowMutationResponse, Error, StepRequest> {
  return useMutation({
    mutationFn: (request: StepRequest) =>
      takeWorkflowStep({
        document: workflowDocument(document as ReleaseDocumentRef),
        ...request,
      }),
    // Read again whether it moved or was refused: a refusal for a stale
    // revision means the state on screen is not the one stored.
  });
}

/** An assignment as the editor asks it, the document named by the hook. */
export type AssignRequest = Omit<AssignmentPayload, "document">;

/** Assigns one part of the document, then reads its review state again. */
export function useAssignPart(
  document: ReleaseDocumentRef | undefined
): UseMutationResult<WorkflowMutationResponse, Error, AssignRequest> {
  return useMutation({
    mutationFn: (request: AssignRequest) =>
      assignWorkflowParts([
        {
          document: workflowDocument(document as ReleaseDocumentRef),
          ...request,
        },
      ]),
  });
}
