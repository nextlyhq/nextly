"use client";

/**
 * How a document moves through a workflow, read from its code: each stage in
 * order, on its colour, with the steps out of it and where each leads.
 *
 * Drawn as stages in a row rather than as one chain, so a workflow whose steps
 * branch or return reads as truly as one that runs straight. To a screen
 * reader the drawing is one image with a sentence for its label, followed by
 * the same steps as an ordered list.
 */

import { ArrowRight } from "lucide-react";
import type React from "react";

import type {
  WorkflowSettingsView,
  WorkflowSummary,
} from "@admin/types/workflows";

import { StagePill } from "./StagePill";
import { diagramSentences, stageLabel } from "./workflow-settings-model";

export interface WorkflowDiagramProps {
  workflow: WorkflowSummary;
  settings: WorkflowSettingsView | undefined;
}

export function WorkflowDiagram({
  workflow,
  settings,
}: WorkflowDiagramProps): React.JSX.Element {
  const labelOf = (stage: string) => stageLabel(workflow, settings, stage);
  const sentences = diagramSentences(workflow, labelOf);
  return (
    <figure className="m-0">
      <div
        role="img"
        aria-label={sentences.join(" ")}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        {workflow.stages.map(stage => {
          const outgoing = workflow.steps.filter(step =>
            step.from.includes(stage.name)
          );
          return (
            <div
              key={stage.name}
              className="space-y-2 rounded-md border border-border bg-background p-3"
            >
              <StagePill
                label={labelOf(stage.name)}
                colour={settings?.labels[stage.name]?.colour}
              />
              <p className="text-xs text-muted-foreground">
                {stage.allowsPublish
                  ? "May be published"
                  : stage.name === workflow.stages[0]?.name
                    ? "Where every document starts"
                    : "Not yet publishable"}
              </p>
              {outgoing.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {outgoing.map(step => (
                    <li key={step.name} className="flex items-center gap-1.5">
                      <span className="font-medium">{step.label}</span>
                      <ArrowRight
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      <span className="text-muted-foreground">
                        {labelOf(step.to)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <ol className="sr-only">
        {sentences.map(sentence => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ol>
    </figure>
  );
}
