"use client";

/**
 * How a document moves through a workflow, read from its code: each stage in
 * order, on its colour, with how many documents are recorded there, the steps
 * out of it, where each leads and the permission it needs; then where an edit
 * to approved content and the next draft after a publish go.
 *
 * Drawn as stages in a row rather than as one chain, so a workflow whose steps
 * branch or return reads as truly as one that runs straight. To a screen
 * reader the drawing is one image with a sentence for its label, followed by
 * the same steps as an ordered list.
 */

import { ArrowRight, CornerUpLeft, RotateCcw } from "lucide-react";
import type React from "react";

import type {
  WorkflowSettingsView,
  WorkflowSummary,
} from "@admin/types/workflows";

import { StagePill } from "./StagePill";
import {
  diagramSentences,
  documentsPhrase,
  stageLabel,
} from "./workflow-settings-model";

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
              <p className="text-sm font-medium">
                {documentsPhrase(workflow.stageCounts[stage.name] ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground">
                {stage.allowsPublish
                  ? "May be published"
                  : stage.name === workflow.stages[0]?.name
                    ? "Where every document starts"
                    : "Not yet publishable"}
              </p>
              {outgoing.length > 0 && (
                <ul className="space-y-1.5 text-sm">
                  {outgoing.map(step => (
                    <li key={step.name}>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{step.label}</span>
                        <ArrowRight
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-muted-foreground"
                        />
                        <span className="text-muted-foreground">
                          {labelOf(step.to)}
                        </span>
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Needs <code>{step.permission}</code>
                        {step.commentRequired ? ", with a comment" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <div
        aria-hidden="true"
        className="mt-3 space-y-1 text-sm text-muted-foreground"
      >
        <p className="flex items-center gap-2">
          <RotateCcw className="size-4 shrink-0" />
          An edit to approved content returns it to{" "}
          {labelOf(workflow.onEdit.to)}.
        </p>
        <p className="flex items-center gap-2">
          <CornerUpLeft className="size-4 shrink-0" />
          Once published, the next draft starts at{" "}
          {labelOf(workflow.afterPublish)}.
        </p>
      </div>
      <ol className="sr-only">
        {sentences.map(sentence => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ol>
    </figure>
  );
}
