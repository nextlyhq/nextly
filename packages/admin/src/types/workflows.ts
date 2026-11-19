/**
 * A document's review state, as `GET /api/workflows/review-state` answers it,
 * and a workflow and its settings, as `GET /api/workflows` and
 * `/api/workflows/:slug/settings` answer them.
 *
 * Spelled here because the server keeps these shapes in its workflows domain
 * (`review-api.ts`, `workflow-settings-api.ts`) rather than in
 * `nextly/schemas`, so there is no type to import. Dates arrive as ISO strings
 * over JSON.
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

/** A stage of a registered workflow. */
export interface WorkflowStageSummary {
  /** Its name in code, the API and the record. */
  name: string;
  /** The label the code gives it. */
  label: string;
  allowsPublish: boolean;
  /** The step its default reviewer must hold: its only step out, or the one marked primary. */
  primaryStep: string | null;
  /** Whether it is a review stage: one with a step of kind approve out of it. */
  review: boolean;
}

/** A step of a registered workflow. */
export interface WorkflowStepSummary {
  name: string;
  label: string;
  kind: WorkflowStepKind;
  from: string[];
  to: string;
  /** Marked primary in code; a stage's only step out of it is its primary step too. */
  primary: boolean;
  /** Whether which roles hold it is a setting: a step naming a permission of its own. */
  grantable: boolean;
  /** The action taking it needs: its own, or the collection's `update` or `publish`. */
  permission: string;
  commentRequired: boolean;
}

/** A registered workflow, as `GET /workflows` lists it. */
export interface WorkflowSummary {
  slug: string;
  label: string;
  /** The configuration file registering it, relative to the project root, or null. */
  configPath: string | null;
  stages: WorkflowStageSummary[];
  steps: WorkflowStepSummary[];
  /** Where an edit to approved content moves it, and the fields whose edits keep the approval. */
  onEdit: { to: string; exemptFields: string[] };
  /** The stage a part's next draft starts at once it is published. */
  afterPublish: string;
  /** How many documents are recorded in each stage, by stage name. */
  stageCounts: Record<string, number>;
  collections: string[];
  singles: string[];
}

/** Whether a person or role holds a step: `holds`, or why not. */
export type WorkflowHolderAnswer =
  | "holds"
  | "lacks"
  | "not-found"
  | "deactivated";

/** A default reviewer: a person or a whole role, as a part's assignee is named. */
export type WorkflowAssignee = ReviewAssignee;

/** Whether each notification also sends an email. */
export interface WorkflowEmailSettings {
  assigned: boolean;
  approved: boolean;
  changesRequested: boolean;
}

/** The triggers a notification email can be switched for. */
export type WorkflowEmailTrigger = keyof WorkflowEmailSettings;

/** A stage's label and colour shown over the code's. */
export interface WorkflowStageLabel {
  label?: string;
  colour?: string;
}

/** A grantable step's permission as it stands, beyond the roles holding it everywhere. */
export interface GrantableStepView {
  /** The action it needs, held as `<permission>-<slug>` on each attachment. */
  permission: string;
  /** Roles holding it on some attachments only; a write naming the step takes it from them. */
  partialRoles: { id: string; name: string | null }[];
  /** Other grantable steps needing the same permission, which hold whatever this one holds. */
  sharesPermissionWith: string[];
}

/** A workflow's settings, as `GET /workflows/:slug/settings` answers them. */
export interface WorkflowSettingsView {
  workflow: string;
  /** What a write says it read; 0 for settings never changed. */
  revision: number;
  defaultReviewers: Record<string, WorkflowAssignee>;
  labels: Record<string, WorkflowStageLabel>;
  emails: WorkflowEmailSettings;
  /** The roles holding each grantable step everywhere, super-admin left out. */
  grants: Record<string, string[]>;
  grantableSteps: Record<string, GrantableStepView>;
  /** Whether each stage's default reviewer still holds its primary step everywhere. */
  defaultReviewerHolds: Record<string, WorkflowHolderAnswer>;
  /**
   * The roles holding each review stage's primary step on every attachment, by stage name:
   * granted it, inheriting it or super-admin. Whom a default reviewer is chosen from, a person
   * through any of these roles.
   */
  reviewerRoles: Record<string, string[]>;
}

/**
 * One change to a workflow's settings, without the revision it is made over:
 * a stage named with `null` loses its default reviewer or labels, and a step
 * named in `grants` is held by exactly the roles listed.
 */
export interface WorkflowSettingsPatch {
  defaultReviewers?: Record<string, WorkflowAssignee | null>;
  labels?: Record<
    string,
    { label?: string | null; colour?: string | null } | null
  >;
  emails?: Partial<WorkflowEmailSettings>;
  grants?: Record<string, string[]>;
}

/** A change as the PATCH body sends it: the patch, over the revision read. */
export interface WorkflowSettingsChange extends WorkflowSettingsPatch {
  revision: number;
}
