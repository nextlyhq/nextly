/**
 * A workflow's definition hash: what its structure is, so an approval can
 * tell the definition it was given under.
 *
 * @module domains/workflows/hash
 * @experimental
 */

import { createHash } from "node:crypto";

import { canonicalJson } from "../../shared/lib/canonical-json";

import type { Workflow } from "./types";

/**
 * The parts of a workflow that decide how a document moves: stages and
 * whether each allows publishing, steps with their kinds, stages and rules,
 * and where parts go automatically. Labels are left out, so renaming a stage
 * or a step never reads as a change of workflow; so are the collections and
 * Singles it is attached to, so attaching it to one more never withdraws an
 * approval elsewhere. A step's `from` and the exempt fields are sorted: their
 * order means nothing. A stage's `renamedFrom` is left out too: it moves no
 * part from one stage to another, only records the name a stage had, so
 * adding it, or dropping it once the deploy has moved the parts, is no change
 * of workflow.
 */
function structureOf(workflow: Workflow): unknown {
  return {
    stages: workflow.stages.map(stage => ({
      name: stage.name,
      allowsPublish: stage.allowsPublish,
    })),
    steps: workflow.steps.map(step => ({
      name: step.name,
      kind: step.kind,
      from: [...step.from].sort(),
      to: step.to,
      permission: step.permission,
      commentRequired: step.commentRequired,
      refusesSelfApproval: step.refusesSelfApproval,
      primary: step.primary,
    })),
    onEdit: {
      to: workflow.onEdit.to,
      exemptFields: [...workflow.onEdit.exemptFields].sort(),
    },
    afterPublish: workflow.afterPublish,
    approvalsWithdrawnTo: workflow.approvalsWithdrawnTo,
    removedStages: workflow.removedStages,
    keepApprovals: workflow.keepApprovals,
  };
}

/**
 * The definition hash: sha256 of the canonical JSON of the workflow's
 * structure, in hex.
 *
 * @experimental
 */
export function workflowDefinitionHash(workflow: Workflow): string {
  return createHash("sha256")
    .update(canonicalJson(structureOf(workflow)) ?? "")
    .digest("hex");
}

/**
 * The workflow as it stood before its stages were renamed: each stage that
 * records a `renamedFrom` named by it again, wherever the definition names
 * that stage. The definition's own value when nothing is renamed.
 */
function beforeRenames(workflow: Workflow): Workflow {
  const earlier = new Map(
    workflow.stages.flatMap(stage =>
      stage.renamedFrom === undefined
        ? []
        : [[stage.name, stage.renamedFrom] as const]
    )
  );
  if (earlier.size === 0) return workflow;
  const named = (stage: string): string => earlier.get(stage) ?? stage;
  return {
    ...workflow,
    stages: workflow.stages.map(stage => ({
      name: named(stage.name),
      label: stage.label,
      allowsPublish: stage.allowsPublish,
    })),
    steps: workflow.steps.map(step => ({
      ...step,
      from: step.from.map(named),
      to: named(step.to),
    })),
    firstStage: named(workflow.firstStage),
    onEdit: { ...workflow.onEdit, to: named(workflow.onEdit.to) },
    afterPublish: named(workflow.afterPublish),
    approvalsWithdrawnTo: named(workflow.approvalsWithdrawnTo),
    removedStages: Object.fromEntries(
      Object.entries(workflow.removedStages).map(([removed, to]) => [
        removed,
        named(to),
      ])
    ),
  };
}

/**
 * The hash the workflow had before its stages were renamed: what a review
 * state written under the definition it was renamed from carries. A deploy
 * whose only change is a rename finds those states by it, and keeps their
 * approvals, since a rename moves no part from one stage to another. The
 * workflow's own hash when nothing is renamed.
 *
 * @experimental
 */
export function definitionHashBeforeRenames(workflow: Workflow): string {
  return workflowDefinitionHash(beforeRenames(workflow));
}
