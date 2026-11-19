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
  /** Whether the caller may take it on this part, as the server judges the step's own checks. */
  mayTake: boolean;
  /** Whether it is its stage's primary step: the editor's main action there. */
  primary: boolean;
  /** Whether it is taken only with a comment, as its definition says. */
  commentRequired: boolean;
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
  /** Null where no workflow is attached; there are then no parts. */
  workflow: { slug: string; label: string } | null;
  parts: PartReview[];
  /** Whether the caller may publish the document without review, as the server judges it. */
  mayPublishWithoutReview: boolean;
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
  /**
   * The parts to move: languages, and null for the shared part. `"all"` is
   * every part of the document; those whose stage the step does not leave
   * from are named in the answer's `left`.
   */
  parts: (string | null)[] | "all";
  seen: { part: string | null; revision: number; version: string }[];
  comment?: string | null;
}

/** A part a step did not move, and the stage it stays in. */
export interface LeftPart {
  part: string | null;
  stage: string;
}

/** What `POST /api/workflows/steps` answers a step taken with, as its `item`. */
export interface TakeStepResult {
  step: string;
  moved: { part: string | null; from: string; to: string }[];
  left: LeftPart[];
}

/** One assignment in `POST /api/workflows/assignments`. */
export interface AssignmentPayload {
  document: WorkflowDocumentRef;
  part: string | null;
  revision: number;
  assignee: ReviewAssignee | null;
  dueAt?: string | null;
}
