/**
 * A workflow and its settings, as the server's `/workflows` routes answer them.
 *
 * Mirrors `WorkflowSummary`, `WorkflowSettingsView` and `WorkflowSettingsChange`
 * in `packages/nextly/src/domains/workflows/workflow-settings-api.ts`, which the
 * core package does not export to the admin's import surface. Kept field for
 * field, so a reader of either file reads the same shape.
 *
 * @module types/workflows
 */

/** What a step does; the server's rules follow a step's kind, never its name. */
export type WorkflowStepKind =
  | "submit"
  | "approve"
  | "request-changes"
  | "move";

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

/** A default reviewer: a person or a whole role. */
export interface WorkflowAssignee {
  kind: "user" | "role";
  id: string;
}

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
