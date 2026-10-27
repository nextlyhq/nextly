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
 * order means nothing.
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
