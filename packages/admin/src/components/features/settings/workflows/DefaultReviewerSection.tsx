"use client";

/**
 * The default reviewer of each review stage: the person or role a document is
 * assigned to when it enters the stage. Only those holding the stage's
 * primary step are offered (`reviewerOptions`); the current reviewer stays
 * listed even when they no longer hold it, marked so, so the choice on screen
 * is always the one stored.
 *
 * Each stage is saved on its own, and a choice not yet saved is kept through
 * a save that meets settings changed meanwhile.
 */

import { Button } from "@nextlyhq/ui";
import type React from "react";
import { useState } from "react";

import type {
  WorkflowAssignee,
  WorkflowSettingsView,
  WorkflowSummary,
} from "@admin/types/workflows";

import { StagePill } from "./StagePill";
import {
  assigneeKey,
  primaryStepOf,
  reviewStages,
  stageLabel,
  type ReviewerOption,
} from "./workflow-settings-model";

export interface DefaultReviewerSectionProps {
  workflow: WorkflowSummary;
  settings: WorkflowSettingsView;
  /** The options a stage's reviewer may be chosen from. */
  optionsFor: (stage: string) => ReviewerOption[];
  /** Whether the options were read off the grants, or the server judges the choice. */
  judgedOnSave: (stage: string) => boolean;
  /** How the current reviewer is named where the options do not carry them. */
  nameOf: (assignee: WorkflowAssignee) => string;
  canChange: boolean;
  /** The field being saved (`defaultReviewers.<stage>`), or null. */
  saving: string | null;
  errors: Record<string, string>;
  onSave: (
    stage: string,
    reviewer: WorkflowAssignee | null
  ) => Promise<boolean>;
}

const NONE = "";

function parseKey(key: string): WorkflowAssignee | null {
  if (key === NONE) return null;
  const [kind, ...rest] = key.split(":");
  return kind === "user" || kind === "role"
    ? { kind, id: rest.join(":") }
    : null;
}

export function DefaultReviewerSection({
  workflow,
  settings,
  optionsFor,
  judgedOnSave,
  nameOf,
  canChange,
  saving,
  errors,
  onSave,
}: DefaultReviewerSectionProps): React.JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const stages = reviewStages(workflow);

  if (stages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This workflow has no review stage: no stage has an approval out of it.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {stages.map(stage => {
        const field = `defaultReviewers.${stage.name}`;
        const label = stageLabel(workflow, settings, stage.name);
        const stored = settings.defaultReviewers[stage.name];
        const storedKey = stored ? assigneeKey(stored) : NONE;
        const draft = drafts[stage.name] ?? storedKey;
        const primary = primaryStepOf(workflow, stage.name);
        const options = optionsFor(stage.name);
        const listed = options.some(
          option => assigneeKey(option.assignee) === storedKey
        );
        const selectId = `default-reviewer-${stage.name}`;
        const error = errors[field];
        return (
          <div
            key={stage.name}
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:items-start"
          >
            <div className="space-y-1">
              <StagePill
                label={label}
                colour={settings.labels[stage.name]?.colour}
              />
              {primary && (
                <p className="text-xs text-muted-foreground">
                  Must be able to take {primary.label}
                </p>
              )}
            </div>
            {canChange ? (
              <div className="space-y-1">
                <label htmlFor={selectId} className="sr-only">
                  Default reviewer for {label}
                </label>
                <div className="flex flex-wrap gap-2">
                  <select
                    id={selectId}
                    value={draft}
                    disabled={saving === field}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? `${selectId}-error` : undefined}
                    onChange={event =>
                      setDrafts(current => ({
                        ...current,
                        [stage.name]: event.target.value,
                      }))
                    }
                    className="block min-h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
                  >
                    <option value={NONE}>No default reviewer</option>
                    {stored && !listed && (
                      <option value={storedKey}>
                        {nameOf(stored)} (no longer offered)
                      </option>
                    )}
                    {options.map(option => (
                      <option
                        key={assigneeKey(option.assignee)}
                        value={assigneeKey(option.assignee)}
                      >
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    disabled={draft === storedKey || saving === field}
                    aria-label={`Save default reviewer for ${label}`}
                    onClick={() => {
                      void onSave(stage.name, parseKey(draft)).then(saved => {
                        if (saved) {
                          setDrafts(current =>
                            Object.fromEntries(
                              Object.entries(current).filter(
                                ([name]) => name !== stage.name
                              )
                            )
                          );
                        }
                      });
                    }}
                  >
                    Save
                  </Button>
                </div>
                {judgedOnSave(stage.name) && (
                  <p className="text-xs text-muted-foreground">
                    Whether they can take {primary?.label ?? "its step"} is
                    checked when you save.
                  </p>
                )}
                {error && (
                  <p
                    id={`${selectId}-error`}
                    className="text-xs text-danger-text"
                    role="alert"
                  >
                    {error}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm">
                {stored ? nameOf(stored) : "No default reviewer"}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
