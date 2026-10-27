/**
 * The shape of an editorial workflow, as a developer declares it in code.
 *
 * Plain data, with no functions inside, so a definition can be validated,
 * hashed and shown in Settings, and so checks on a step can later be added by
 * name. Stages and steps carry the names the generated types are built from.
 *
 * @module domains/workflows/types
 * @experimental
 */

/**
 * What a step does. The system's rules follow a step's kind, never its name.
 *
 * @experimental
 */
export const WORKFLOW_STEP_KINDS = [
  "submit",
  "approve",
  "request-changes",
  "move",
] as const;

/** @experimental */
export type WorkflowStepKind = (typeof WORKFLOW_STEP_KINDS)[number];

/**
 * A stage a part of a document can be in.
 *
 * @experimental
 */
export interface WorkflowStage<S extends string = string> {
  /** Its name in code, the generated types and the record. */
  name: S;
  /** How the admin shows it. */
  label: string;
  /** Whether content in this stage may be published. */
  allowsPublish?: boolean;
}

/**
 * A step a person takes to move a part from one stage to another.
 *
 * @experimental
 */
export interface WorkflowStep<
  S extends string = string,
  T extends string = string,
> {
  /** Its name in code, the generated types and the record. */
  name: T;
  /** How the admin shows it. */
  label: string;
  kind: WorkflowStepKind;
  /** The stage or stages it may be taken from. */
  from: NoInfer<S> | readonly NoInfer<S>[];
  /** The stage it moves the part to. */
  to: NoInfer<S>;
  /**
   * The action the person taking it needs on the collection or Single, in
   * kebab-case (`approve` is held as `approve-<slug>`). None means the
   * collection's own edit permission.
   */
  permission?: string;
  /**
   * Whether a comment is required. A step of kind `request-changes` always
   * requires one: leaving this out means required, and `false` is refused.
   */
  commentRequired?: boolean;
  /**
   * Whether the person who brought the part into its stage is refused this
   * step. Allowed unless the step says so.
   */
  refusesSelfApproval?: boolean;
  /**
   * The stage's main step: the editor's main action, and the step a stage's
   * default reviewer must hold. A stage with more than one outgoing step
   * marks exactly one.
   */
  primary?: boolean;
}

/**
 * A workflow as declared.
 *
 * @experimental
 */
export interface WorkflowInput<
  S extends string = string,
  T extends string = string,
> {
  /** Its name in Settings and the generated types: kebab-case. */
  slug: string;
  label: string;
  /** In order; the first is where every part starts. */
  stages: readonly WorkflowStage<S>[];
  steps: readonly WorkflowStep<S, T>[];
  /** What an edit to approved content does. */
  onEdit?: {
    /**
     * The stage an approved part moves to when edited. By default the first
     * review stage, the first stage with an outgoing step of kind `approve`.
     */
    to?: NoInfer<S>;
    /** Fields whose edits keep an approval. */
    exemptFields?: readonly string[];
  };
  /**
   * The stage a part's next working draft starts at once it is published.
   * By default the first stage.
   */
  afterPublish?: NoInfer<S>;
  /**
   * Where a part goes when its approval is withdrawn by a change of
   * definition. By default the first stage.
   */
  approvalsWithdrawnTo?: NoInfer<S>;
  /**
   * Stages this definition no longer has, and the stage each one's parts
   * move to.
   */
  removedStages?: Readonly<Record<string, NoInfer<S>>>;
  /**
   * Whether approvals given under an earlier definition stand. By default
   * they are withdrawn.
   */
  keepApprovals?: boolean;
}

/**
 * A step as the system reads it: its `from` always a list, and its comment
 * and self-approval rules decided.
 *
 * @experimental
 */
export interface ResolvedWorkflowStep<
  S extends string = string,
  T extends string = string,
> {
  name: T;
  label: string;
  kind: WorkflowStepKind;
  from: readonly S[];
  to: S;
  permission: string | null;
  commentRequired: boolean;
  refusesSelfApproval: boolean;
  primary: boolean;
}

/**
 * A validated workflow, with every default decided. What a collection or
 * Single is given in its `workflow` option.
 *
 * @experimental
 */
export interface Workflow<
  S extends string = string,
  T extends string = string,
> {
  /** Marks a value `defineWorkflow` made, so a hand-built object is refused. */
  readonly kind: "nextly-workflow";
  readonly slug: string;
  readonly label: string;
  readonly stages: readonly Required<WorkflowStage<S>>[];
  readonly steps: readonly ResolvedWorkflowStep<S, T>[];
  readonly firstStage: S;
  readonly onEdit: { readonly to: S; readonly exemptFields: readonly string[] };
  readonly afterPublish: S;
  readonly approvalsWithdrawnTo: S;
  readonly removedStages: Readonly<Record<string, S>>;
  readonly keepApprovals: boolean;
}

/** A workflow's stage names. @experimental */
export type WorkflowStageName<W> =
  W extends Workflow<infer S, string> ? S : never;

/** A workflow's step names. @experimental */
export type WorkflowStepName<W> =
  W extends Workflow<string, infer T> ? T : never;
