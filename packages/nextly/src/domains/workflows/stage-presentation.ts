/**
 * How a stage is shown wherever it is shown: the label and colour admins saved for it in Settings
 * (`nextly_workflow_settings`), else the code's label and no colour. The one answer the review
 * state, what waits for a caller, and the list of workflows give, so a label saved in Settings is
 * the label every surface shows.
 *
 * @module domains/workflows/stage-presentation
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../../di/container";

import { attachedWorkflowSummary, workflowAttachedTo } from "./registry";
import { primaryAction, stepAction } from "./step-actions";
import type { Workflow } from "./types";
import {
  readWorkflowSettings,
  type WorkflowSettings,
} from "./workflow-settings-repository";

/** A stage as a reader is shown it. @experimental */
export interface StagePresentation {
  label: string;
  /** The colour saved for it, a hex value; null where none is, never a guessed one. */
  colour: string | null;
}

/**
 * How `stage` of `workflow` is shown under `settings`: the saved label over the code's, the saved
 * colour or none. A stage the workflow no longer has keeps its name for a label.
 */
function stagePresentation(
  workflow: Workflow,
  settings: WorkflowSettings | undefined,
  stage: string
): StagePresentation {
  const saved = settings?.stages?.[stage];
  return {
    label:
      saved?.label ??
      workflow.stages.find(each => each.name === stage)?.label ??
      stage,
    colour: saved?.colour ?? null,
  };
}

/**
 * How each stage of `workflow` is shown, its settings read once: for a reader that shows several
 * stages of one workflow.
 */
export async function readStagePresentation(
  adapter: DrizzleAdapter,
  workflow: Workflow
): Promise<(stage: string) => StagePresentation> {
  const settings = (await readWorkflowSettings(adapter, workflow.slug))
    ?.settings;
  return stage => stagePresentation(workflow, settings, stage);
}

/** A workflow's summary as a schema read names it. */
type AttachedSummary = NonNullable<ReturnType<typeof attachedWorkflowSummary>>;

/** That summary, each step with the action it needs and each stage with its primary step's. */
type ShownWorkflowSummary = Omit<AttachedSummary, "steps" | "stages"> & {
  stages: (AttachedSummary["stages"][number] & {
    /**
     * The action of the stage's primary step (`primaryAction`), absent for a stage with no step
     * out of it. Its permission on the collection or Single lets a caller assign a part in the
     * stage, as `update` does (`assignerPermissions`).
     */
    primaryAction?: string;
  })[];
  steps: (AttachedSummary["steps"][number] & {
    /**
     * The action a caller needs to take it on this collection or Single, as Settings names it
     * (`stepAction`): a list offers its bulk moves to a reader holding one of its steps' actions
     * here, rather than to anyone who reviews anywhere.
     */
    action: string;
  })[];
};

/**
 * The workflow a collection or Single is attached to, as its schema read names it
 * (`attachedWorkflowSummary`), each stage under the label every other surface shows it by: the
 * one saved in Settings, else the code's; and each step with the action it needs. Null where
 * none is attached.
 *
 * @experimental
 */
export async function shownWorkflowSummary(
  kind: "collection" | "single",
  slug: string
): Promise<ShownWorkflowSummary | null> {
  const summary = attachedWorkflowSummary(kind, slug);
  const registered = workflowAttachedTo(kind, slug);
  if (summary === null || registered === undefined) return null;
  const { workflow } = registered;
  const steps = summary.steps.map(step => {
    const resolved = workflow.steps.find(each => each.name === step.name);
    return {
      ...step,
      // Every summary step is one of the registered workflow's; the action falls back to the
      // name-only `update` only if that ever stops holding.
      action: resolved ? stepAction(workflow, resolved) : "update",
    };
  });
  // Each stage with its primary step's action, from the one rule assigning is judged by.
  const stages = summary.stages.map(stage => {
    const action = primaryAction(workflow, stage.name);
    return action === null ? stage : { ...stage, primaryAction: action };
  });
  if (!container.has("adapter")) return { ...summary, steps, stages };
  const shown = await readStagePresentation(
    container.get<DrizzleAdapter>("adapter"),
    workflow
  );
  return {
    ...summary,
    steps,
    stages: stages.map(stage => ({
      ...stage,
      label: shown(stage.name).label,
    })),
  };
}
