/**
 * Declare an editorial workflow: check it, decide its defaults, and return it.
 *
 * Every rule a definition must keep is checked here, when it is declared, so
 * a mistake fails the boot or the build that loads it rather than a document
 * in production. Each error names its place in the definition and the names
 * it could have meant ("`steps[1].to`: `aproved` is not a stage. Known
 * stages: drafting, inReview, approved").
 *
 * @module domains/workflows/define-workflow
 * @experimental
 */

import { NextlyError } from "../../errors";

import {
  WORKFLOW_STEP_KINDS,
  type ResolvedWorkflowStep,
  type Workflow,
  type WorkflowInput,
  type WorkflowStage,
  type WorkflowStep,
} from "./types";

/**
 * The longest stage, step or workflow name: the width the record of content
 * events keeps a stage in.
 *
 * @experimental
 */
export const MAX_WORKFLOW_NAME_LENGTH = 64;

/** A stage or step name: a letter, then letters, digits, `_` or `-`. */
const NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** A workflow's slug and a step's permission: kebab-case. */
const KEBAB = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** One problem with a definition, at its place in it. */
interface WorkflowProblem {
  path: string;
  code: string;
  message: string;
}

/** The problems found so far, in the order the definition reads. */
class Problems {
  readonly list: WorkflowProblem[] = [];

  add(path: string, code: string, message: string): void {
    this.list.push({ path, code, message });
  }
}

/** Names as a known-names list: `a, b, c`. */
function known(names: readonly string[]): string {
  return names.length === 0 ? "(none)" : names.join(", ");
}

/** A stage or step name's own problems: its shape and its length. */
function checkName(
  problems: Problems,
  path: string,
  name: unknown,
  what: "stage" | "step"
): void {
  if (typeof name !== "string" || !NAME.test(name)) {
    problems.add(
      path,
      "workflow_name_invalid",
      `\`${String(name)}\` is not a ${what} name: start with a letter, then use letters, digits, \`_\` or \`-\`.`
    );
    return;
  }
  if (name.length > MAX_WORKFLOW_NAME_LENGTH) {
    problems.add(
      path,
      "workflow_name_too_long",
      `\`${name}\` is ${name.length} characters; a ${what} name may have at most ${MAX_WORKFLOW_NAME_LENGTH}.`
    );
  }
}

/** A label is shown to people, so it says something. */
function checkLabel(problems: Problems, path: string, label: unknown): void {
  if (typeof label !== "string" || label.trim().length === 0) {
    problems.add(
      path,
      "workflow_label_empty",
      "Give it a label to show people."
    );
  }
}

/** Names that appear more than once, each reported at its second place. */
function checkDuplicates(
  problems: Problems,
  names: readonly string[],
  path: (index: number) => string,
  what: "stage" | "step"
): void {
  const seen = new Set<string>();
  names.forEach((name, index) => {
    if (seen.has(name)) {
      problems.add(
        path(index),
        `workflow_duplicate_${what}`,
        `\`${name}\` is already a ${what} of this workflow; each ${what} needs its own name.`
      );
    }
    seen.add(name);
  });
}

/** A reference to a stage, refused unless the definition has it. */
function checkStageRef(
  problems: Problems,
  path: string,
  name: unknown,
  stages: readonly string[]
): void {
  if (typeof name === "string" && stages.includes(name)) return;
  problems.add(
    path,
    "workflow_unknown_stage",
    `\`${String(name)}\` is not a stage. Known stages: ${known(stages)}.`
  );
}

/** What the graph of stages reads of a step, declared or resolved. */
interface GraphStep {
  from: string | readonly string[];
  to: string;
}

/** A step's `from`, always as a list. */
function fromOf(step: GraphStep): readonly string[] {
  return typeof step.from === "string" ? [step.from] : [...step.from];
}

/** A step's own fields: kind, stages, permission and comment. */
function checkStep(
  problems: Problems,
  step: WorkflowStep,
  index: number,
  stages: readonly WorkflowStage[]
): void {
  const at = `steps[${index}]`;
  const names = stages.map(stage => stage.name);
  checkName(problems, `${at}.name`, step.name, "step");
  checkLabel(problems, `${at}.label`, step.label);
  if (!WORKFLOW_STEP_KINDS.includes(step.kind)) {
    problems.add(
      `${at}.kind`,
      "workflow_step_kind_invalid",
      `\`${String(step.kind)}\` is not a kind of step. Known kinds: ${known(WORKFLOW_STEP_KINDS)}.`
    );
  }
  const from = fromOf(step);
  if (from.length === 0) {
    problems.add(
      `${at}.from`,
      "workflow_step_from_empty",
      "Name at least one stage it is taken from."
    );
  }
  from.forEach((name, i) =>
    checkStageRef(
      problems,
      typeof step.from === "string" ? `${at}.from` : `${at}.from[${i}]`,
      name,
      names
    )
  );
  checkStageRef(problems, `${at}.to`, step.to, names);
  checkStepRules(problems, step, at, stages);
}

/** The rules a step's kind sets: the publish rule, comments, permission. */
function checkStepRules(
  problems: Problems,
  step: WorkflowStep,
  at: string,
  stages: readonly WorkflowStage[]
): void {
  checkPublishRule(
    problems,
    step,
    at,
    stages.find(stage => stage.name === step.to)
  );
  checkCommentAndPermission(problems, step, at);
}

/**
 * Only a step of kind approve leads into a stage that allows publishing, and
 * every step of kind approve leads into one.
 */
function checkPublishRule(
  problems: Problems,
  step: WorkflowStep,
  at: string,
  target: WorkflowStage | undefined
): void {
  if (target?.allowsPublish === true && step.kind !== "approve") {
    problems.add(
      `${at}.kind`,
      "workflow_publish_step_not_approve",
      `\`${step.name}\` leads into \`${target.name}\`, which allows publishing, so it must be of kind \`approve\`.`
    );
  }
  if (
    step.kind === "approve" &&
    target !== undefined &&
    target.allowsPublish !== true
  ) {
    problems.add(
      `${at}.to`,
      "workflow_approve_not_publishable",
      `\`${step.name}\` is of kind \`approve\`, so it must lead into a stage that allows publishing; \`${target.name}\` does not.`
    );
  }
}

/** A request for changes always asks why; a permission is an action name. */
function checkCommentAndPermission(
  problems: Problems,
  step: WorkflowStep,
  at: string
): void {
  if (step.kind === "request-changes" && step.commentRequired === false) {
    problems.add(
      `${at}.commentRequired`,
      "workflow_request_changes_comment",
      `\`${step.name}\` asks for changes, which always needs a comment; leave \`commentRequired\` out or set it to \`true\`.`
    );
  }
  if (step.permission !== undefined && !KEBAB.test(step.permission)) {
    problems.add(
      `${at}.permission`,
      "workflow_permission_invalid",
      `\`${step.permission}\` is not an action name: use kebab-case, such as \`approve\`.`
    );
  }
}

/** A stage with several outgoing steps marks exactly one as primary. */
function checkPrimaries(
  problems: Problems,
  stages: readonly WorkflowStage[],
  steps: readonly WorkflowStep[]
): void {
  stages.forEach((stage, index) => {
    const outgoing = steps.filter(step => fromOf(step).includes(stage.name));
    const primaries = outgoing.filter(step => step.primary === true);
    if (
      primaries.length > 1 ||
      (outgoing.length > 1 && primaries.length === 0)
    ) {
      problems.add(
        `stages[${index}]`,
        "workflow_primary_step",
        `\`${stage.name}\` has ${outgoing.length} steps out of it (${known(outgoing.map(step => step.name))}); mark exactly one with \`primary: true\`. It has ${primaries.length}.`
      );
    }
  });
}

/** Stages from which some path of steps leads to a stage that allows publishing. */
function reachingPublish(
  stages: readonly WorkflowStage[],
  steps: readonly GraphStep[]
): Set<string> {
  const reach = new Set(
    stages
      .filter(stage => stage.allowsPublish === true)
      .map(stage => stage.name)
  );
  let grew = true;
  while (grew) {
    grew = false;
    for (const step of steps) {
      if (!reach.has(step.to)) continue;
      for (const from of fromOf(step)) {
        if (!reach.has(from)) {
          reach.add(from);
          grew = true;
        }
      }
    }
  }
  return reach;
}

/** Every stage a part can reach by steps from `start`, `start` included. */
function reachableFrom(
  start: string,
  steps: readonly GraphStep[]
): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const step of steps) {
      if (fromOf(step).includes(next) && !seen.has(step.to)) {
        seen.add(step.to);
        queue.push(step.to);
      }
    }
  }
  return seen;
}

/**
 * No stage a part can come to is a dead end: from every stage reachable from
 * the first stage, the after-publish stage, or a stage a part is moved to
 * automatically, some path of steps leads to a stage that allows publishing.
 */
function checkDeadEnds(
  problems: Problems,
  workflow: Workflow,
  starts: ReadonlyArray<{ stage: string; why: string }>
): void {
  const reach = reachingPublish(workflow.stages, workflow.steps);
  const reported = new Set<string>();
  for (const start of starts) {
    for (const stage of reachableFrom(start.stage, workflow.steps)) {
      if (reach.has(stage) || reported.has(stage)) continue;
      reported.add(stage);
      const index = workflow.stages.findIndex(s => s.name === stage);
      problems.add(
        `stages[${index}]`,
        "workflow_dead_end",
        `\`${stage}\` can be reached (from ${start.why}), but no path of steps leads from it to a stage that allows publishing.`
      );
    }
  }
}

/** The first review stage: the first with an outgoing step of kind approve. */
function firstReviewStage(
  stages: readonly WorkflowStage[],
  steps: readonly WorkflowStep[]
): string | undefined {
  return stages.find(stage =>
    steps.some(
      step => step.kind === "approve" && fromOf(step).includes(stage.name)
    )
  )?.name;
}

/** A step with its defaults decided. */
function resolveStep(step: WorkflowStep): ResolvedWorkflowStep {
  return {
    name: step.name,
    label: step.label,
    kind: step.kind,
    from: fromOf(step),
    to: step.to,
    permission: step.permission ?? null,
    // A request for changes always asks why.
    commentRequired:
      step.kind === "request-changes" ? true : step.commentRequired === true,
    refusesSelfApproval: step.refusesSelfApproval === true,
    primary: step.primary === true,
  };
}

/** Where a part goes automatically, with each default decided. */
function automaticStages(
  input: WorkflowInput,
  first: string
): Pick<
  Workflow,
  | "onEdit"
  | "afterPublish"
  | "approvalsWithdrawnTo"
  | "removedStages"
  | "keepApprovals"
> {
  return {
    onEdit: {
      to:
        input.onEdit?.to ??
        firstReviewStage(input.stages, input.steps) ??
        first,
      exemptFields: [...(input.onEdit?.exemptFields ?? [])],
    },
    afterPublish: input.afterPublish ?? first,
    approvalsWithdrawnTo: input.approvalsWithdrawnTo ?? first,
    removedStages: { ...(input.removedStages ?? {}) },
    keepApprovals: input.keepApprovals === true,
  };
}

/** The definition with every default decided; checked separately. */
function resolve(input: WorkflowInput): Workflow {
  const first = input.stages[0]?.name ?? "";
  return {
    kind: "nextly-workflow",
    slug: input.slug,
    label: input.label,
    stages: input.stages.map(stage => ({
      name: stage.name,
      label: stage.label,
      allowsPublish: stage.allowsPublish === true,
    })),
    steps: input.steps.map(resolveStep),
    firstStage: first,
    ...automaticStages(input, first),
  };
}

/** The definition's top-level fields: slug, label and stages. */
function checkStages(problems: Problems, input: WorkflowInput): void {
  if (typeof input.slug !== "string" || !KEBAB.test(input.slug)) {
    problems.add(
      "slug",
      "workflow_slug_invalid",
      `\`${String(input.slug)}\` is not a workflow slug: use kebab-case, such as \`editorial\`.`
    );
  } else if (input.slug.length > MAX_WORKFLOW_NAME_LENGTH) {
    problems.add(
      "slug",
      "workflow_name_too_long",
      `\`${input.slug}\` is ${input.slug.length} characters; a slug may have at most ${MAX_WORKFLOW_NAME_LENGTH}.`
    );
  }
  checkLabel(problems, "label", input.label);
  if (input.stages.length === 0) {
    problems.add("stages", "workflow_no_stages", "Declare at least one stage.");
    return;
  }
  input.stages.forEach((stage, index) => {
    checkName(problems, `stages[${index}].name`, stage.name, "stage");
    checkLabel(problems, `stages[${index}].label`, stage.label);
  });
  checkDuplicates(
    problems,
    input.stages.map(stage => stage.name),
    i => `stages[${i}].name`,
    "stage"
  );
  if (!input.stages.some(stage => stage.allowsPublish === true)) {
    problems.add(
      "stages",
      "workflow_no_publishable_stage",
      "No stage allows publishing: mark one with `allowsPublish: true`."
    );
  }
}

/** The stages a part is moved to without a step, each named. */
function automaticTargets(
  input: WorkflowInput,
  names: readonly string[],
  problems: Problems
): void {
  if (input.onEdit?.to !== undefined)
    checkStageRef(problems, "onEdit.to", input.onEdit.to, names);
  if (input.afterPublish !== undefined)
    checkStageRef(problems, "afterPublish", input.afterPublish, names);
  if (input.approvalsWithdrawnTo !== undefined) {
    checkStageRef(
      problems,
      "approvalsWithdrawnTo",
      input.approvalsWithdrawnTo,
      names
    );
  }
  for (const [removed, to] of Object.entries(input.removedStages ?? {})) {
    if (names.includes(removed)) {
      problems.add(
        `removedStages.${removed}`,
        "workflow_removed_stage_present",
        `\`${removed}\` is still a stage of this workflow, so it cannot also be removed.`
      );
    }
    checkStageRef(problems, `removedStages.${removed}`, to, names);
  }
}

/** Each place a part can start from or be moved to, for the dead-end check. */
function startsOf(workflow: Workflow): Array<{ stage: string; why: string }> {
  return [
    { stage: workflow.firstStage, why: "the first stage" },
    { stage: workflow.afterPublish, why: "`afterPublish`" },
    { stage: workflow.onEdit.to, why: "`onEdit.to`" },
    { stage: workflow.approvalsWithdrawnTo, why: "`approvalsWithdrawnTo`" },
    ...Object.entries(workflow.removedStages).map(([removed, stage]) => ({
      stage,
      why: `\`removedStages.${removed}\``,
    })),
  ];
}

/** Every rule that reads the definition whole, once its parts are sound. */
function checkWhole(problems: Problems, workflow: Workflow): void {
  const after = workflow.stages.find(
    stage => stage.name === workflow.afterPublish
  );
  if (after?.allowsPublish === true) {
    problems.add(
      "afterPublish",
      "workflow_after_publish_publishable",
      `\`${after.name}\` allows publishing, so a new draft would start already approved; name a stage before review.`
    );
  }
  checkDeadEnds(problems, workflow, startsOf(workflow));
}

/**
 * Check a workflow and return it with every default decided.
 *
 * Throws a validation error listing every problem found, each at its place in
 * the definition, so one run shows them all.
 *
 * @example
 * ```ts
 * import { defineCollection, defineWorkflow } from "nextly/config";
 *
 * export const editorial = defineWorkflow({
 *   slug: "editorial",
 *   label: "Editorial review",
 *   stages: [
 *     { name: "drafting", label: "Drafting" },
 *     { name: "inReview", label: "In review" },
 *     { name: "approved", label: "Approved", allowsPublish: true },
 *   ],
 *   steps: [
 *     { name: "submit", label: "Submit for review", kind: "submit", from: "drafting", to: "inReview" },
 *     { name: "approve", label: "Approve", kind: "approve", from: "inReview", to: "approved", permission: "approve", primary: true },
 *     { name: "requestChanges", label: "Request changes", kind: "request-changes", from: ["inReview", "approved"], to: "drafting" },
 *   ],
 * });
 *
 * export const Posts = defineCollection({
 *   slug: "posts",
 *   status: true,
 *   versions: { drafts: true },
 *   workflow: editorial,
 *   fields: [],
 * });
 * ```
 *
 * @experimental
 */
export function defineWorkflow<const S extends string, const T extends string>(
  input: WorkflowInput<S, T>
): Workflow<S, T> {
  const problems = new Problems();
  checkStages(problems, input);
  const names = input.stages.map(stage => stage.name as string);
  input.steps.forEach((step, index) =>
    checkStep(problems, step, index, input.stages)
  );
  checkDuplicates(
    problems,
    input.steps.map(step => step.name),
    i => `steps[${i}].name`,
    "step"
  );
  checkPrimaries(problems, input.stages, input.steps);
  automaticTargets(input, names, problems);
  // The graph is read only once every name in it resolves; otherwise its
  // errors would describe a workflow nobody declared.
  if (problems.list.length === 0) checkWhole(problems, resolve(input));
  if (problems.list.length > 0) {
    throw NextlyError.validation({
      errors: problems.list,
      logContext: { workflow: input.slug },
    });
  }
  return Object.freeze(resolve(input)) as Workflow<S, T>;
}

/**
 * Whether a stage is a review stage: one with an outgoing step of kind
 * approve.
 *
 * @experimental
 */
export function isReviewStage(workflow: Workflow, stage: string): boolean {
  return workflow.steps.some(
    step => step.kind === "approve" && step.from.includes(stage)
  );
}

/**
 * Whether a move from `from` to `to` enters review, opening a review cycle:
 * from a stage that is not a review stage into one that is, by any step or
 * automatically.
 *
 * @experimental
 */
export function entersReview(
  workflow: Workflow,
  from: string,
  to: string
): boolean {
  return !isReviewStage(workflow, from) && isReviewStage(workflow, to);
}

/**
 * Whether the person who brought a part into its stage may take this step.
 * Allowed unless the step refuses it.
 *
 * @experimental
 */
export function allowsSelfApproval(step: ResolvedWorkflowStep): boolean {
  return !step.refusesSelfApproval;
}

/**
 * A stage's primary step: its only outgoing step, or the one marked primary.
 *
 * @experimental
 */
export function primaryStep(
  workflow: Workflow,
  stage: string
): ResolvedWorkflowStep | undefined {
  const outgoing = workflow.steps.filter(step => step.from.includes(stage));
  return outgoing.length === 1
    ? outgoing[0]
    : outgoing.find(step => step.primary);
}
