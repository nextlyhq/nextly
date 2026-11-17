/**
 * A document's review state, as `GET /api/workflows/review-state` answers it.
 *
 * Spelled here because the server keeps these shapes in its workflows domain
 * rather than in `nextly/schemas`, so there is no type to import. Dates arrive
 * as ISO strings over JSON.
 *
 * @module types/workflows
 * @experimental
 */

/** What a step does, which decides where the editor draws it. */
export type WorkflowStepKind =
  | "submit"
  | "approve"
  | "request-changes"
  | "move";

/** A step a part may take from the stage it stands in. */
export interface ReviewStep {
  name: string;
  label: string;
  kind: WorkflowStepKind;
  to: string;
}

/** Whom a part is assigned to: one person, or anyone holding one role. */
export interface ReviewAssignee {
  kind: "user" | "role";
  id: string;
}

/** Who a part waits for: one person, or anyone holding one of some roles. */
export type ReviewWaitingFor =
  | { kind: "user"; id: string; name: string | null }
  | { kind: "roles"; roles: { id: string; name: string | null }[] };

/** The part's latest workflow event other than an assignment. */
export interface ReviewLastMove {
  kind: string;
  /** Who moved it; a system move names no one, and may name no id. */
  actor: { kind: string; id?: string; name?: string | null };
  at: string;
  from: string | null;
  to: string | null;
  comment: string | null;
}

/** One part's review state: a language, or `null` for the shared part. */
export interface PartReview {
  part: string | null;
  /** Null for a live part with nothing waiting to go live. */
  stage: string | null;
  stageLabel: string | null;
  /** Whether its stage allows publishing. */
  publishable: boolean;
  enteredAt: string | null;
  enteredBy: string | null;
  assignee: ReviewAssignee | null;
  dueAt: string | null;
  approval: { versionNo: number; by: string; at: string } | null;
  /** What a step or an assignment says it saw. */
  revision: number;
  version: string | null;
  steps: ReviewStep[];
  waitingFor: ReviewWaitingFor | null;
  lastMove: ReviewLastMove | null;
}

/** A document's review state, part by part. */
export interface DocumentReview {
  workflow: { slug: string; label: string };
  parts: PartReview[];
}

/**
 * What the editor knows of a document's review: no workflow attached, or the
 * attached workflow's state. Kept apart from a failed read, which is an error.
 */
export type ReviewStateAnswer =
  | { attached: false }
  | { attached: true; review: DocumentReview };

/** A document as the workflow routes name it. */
export type WorkflowDocumentRef =
  | { collection: string; id: string }
  | { single: string };

/** The body of `POST /api/workflows/steps`. */
export interface TakeStepPayload {
  document: WorkflowDocumentRef;
  step: string;
  parts: (string | null)[];
  seen: { part: string | null; revision: number; version: string }[];
  comment?: string | null;
}

/** One assignment in `POST /api/workflows/assignments`. */
export interface AssignmentPayload {
  document: WorkflowDocumentRef;
  part: string | null;
  revision: number;
  assignee: ReviewAssignee | null;
  dueAt?: string | null;
}
