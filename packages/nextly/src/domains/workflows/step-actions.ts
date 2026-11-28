/**
 * The action each step and stage of a workflow needs, read from the workflow
 * definition alone.
 *
 * A module of its own, apart from `steps.ts`, because the schema reads that
 * show a workflow (the collection and Single detail, the dispatchers) need
 * these answers and none of the step-taking that `steps.ts` holds, which
 * loads the versions, the content events and the notices. `steps.ts`
 * re-exports them.
 *
 * @module domains/workflows/step-actions
 */

import { primaryStep } from "./define-workflow";
import type { ResolvedWorkflowStep, Workflow } from "./types";

/**
 * Whether `stage` allows publishing: the one answer a step into it and a publish from it share.
 *
 * @experimental
 */
export function allowsPublish(workflow: Workflow, stage: string): boolean {
  return workflow.stages.some(
    candidate => candidate.name === stage && candidate.allowsPublish
  );
}

/**
 * The action a step needs: the one it names, else `publish` into a stage that allows publishing,
 * else `update`. Kept as the action, since a permission's slug cannot be split back into its
 * action and resource (a resource may itself hold a hyphen). Exported so Settings shows the
 * permission each step needs from this one answer.
 *
 * @experimental
 */
export function stepAction(
  workflow: Workflow,
  step: ResolvedWorkflowStep
): string {
  if (step.permission !== null) return step.permission;
  return allowsPublish(workflow, step.to) ? "publish" : "update";
}

/**
 * The action of `stage`'s primary step, or null for a stage with no step out of it.
 *
 * @experimental
 */
export function primaryAction(
  workflow: Workflow,
  stage: string
): string | null {
  const primary = primaryStep(workflow, stage);
  return primary ? stepAction(workflow, primary) : null;
}
