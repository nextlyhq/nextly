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

/**
 * The workflow a collection or Single is attached to, as its schema read names it
 * (`attachedWorkflowSummary`), each stage under the label every other surface shows it by: the
 * one saved in Settings, else the code's. Null where none is attached.
 *
 * @experimental
 */
export async function shownWorkflowSummary(
  kind: "collection" | "single",
  slug: string
): Promise<ReturnType<typeof attachedWorkflowSummary>> {
  const summary = attachedWorkflowSummary(kind, slug);
  const registered = workflowAttachedTo(kind, slug);
  if (
    summary === null ||
    registered === undefined ||
    !container.has("adapter")
  ) {
    return summary;
  }
  const shown = await readStagePresentation(
    container.get<DrizzleAdapter>("adapter"),
    registered.workflow
  );
  return {
    ...summary,
    stages: summary.stages.map(stage => ({
      ...stage,
      label: shown(stage.name).label,
    })),
  };
}
