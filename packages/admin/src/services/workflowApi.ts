/**
 * The admin's client for `/api/workflows`: a document's review state, taking
 * a step, and assigning a part.
 *
 * Thin over `fetcher`, like every other service here. One route serves
 * collections and Singles alike: a document is named in the query for a read
 * and in the body for a write.
 *
 * @module services/workflowApi
 * @experimental
 */

import { fetcher } from "../lib/api/fetcher";
import type { ReleaseDocumentRef } from "../types/releases";
import type {
  AssignmentPayload,
  DocumentReview,
  ReviewStateAnswer,
  TakeStepPayload,
  WorkflowDocumentRef,
} from "../types/workflows";

/** A document as the workflow routes name it, from the editor's own reference. */
export function workflowDocument(
  document: ReleaseDocumentRef
): WorkflowDocumentRef {
  return document.scopeKind === "single"
    ? { single: document.scopeSlug }
    : { collection: document.scopeSlug, id: document.entryId };
}

function reviewStateQuery(document: WorkflowDocumentRef): string {
  const search = new URLSearchParams(
    "single" in document
      ? { single: document.single }
      : { collection: document.collection, id: document.id }
  );
  return `?${search.toString()}`;
}

/**
 * A document's review state, or that no workflow is attached to it: the route answers that with
 * no workflow and no parts, not a refusal. A refusal (a document the caller may not read, a
 * server error) is thrown, as a failed read is everywhere else.
 */
export async function fetchReviewState(
  document: WorkflowDocumentRef
): Promise<ReviewStateAnswer> {
  const review = await fetcher<DocumentReview>(
    `/workflows/review-state${reviewStateQuery(document)}`,
    {},
    true
  );
  return review.workflow === null
    ? { attached: false }
    : { attached: true, review };
}

/** The mutation envelope the workflow writes answer with. */
export interface WorkflowMutationResponse {
  message?: string;
  item: unknown;
}

/** Takes one step on one document's parts. */
export const takeWorkflowStep = (
  payload: TakeStepPayload
): Promise<WorkflowMutationResponse> =>
  fetcher<WorkflowMutationResponse>(
    "/workflows/steps",
    { method: "POST", body: JSON.stringify(payload) },
    true
  );

/** Assigns parts, all or nothing. */
export const assignWorkflowParts = (
  assignments: AssignmentPayload[]
): Promise<WorkflowMutationResponse> =>
  fetcher<WorkflowMutationResponse>(
    "/workflows/assignments",
    { method: "POST", body: JSON.stringify({ assignments }) },
    true
  );
