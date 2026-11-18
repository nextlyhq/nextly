"use client";

/**
 * What needs an admin's attention on a workflow, above its settings:
 * - a step no role holds (only super admins can take it): an alert;
 * - a default reviewer who no longer holds their stage's primary step: a
 *   warning, announced politely;
 * - a role holding a step on some collections only: a note, since saving that
 *   step's roles takes it from the role unless it is ticked.
 */

import { Alert, AlertDescription, AlertTitle } from "@nextlyhq/ui";
import { AlertTriangle, Info } from "lucide-react";
import type React from "react";

import type {
  WorkflowAssignee,
  WorkflowSettingsView,
  WorkflowSummary,
} from "@admin/types/workflows";

import {
  attachmentsPhrase,
  listPhrase,
  partlyHeldPermissions,
  primaryStepOf,
  stageLabel,
  unheldPermissions,
} from "./workflow-settings-model";

export interface WorkflowNoticesProps {
  workflow: WorkflowSummary;
  settings: WorkflowSettingsView;
  /** The review stages whose default reviewer no longer holds the primary step. */
  staleStages: readonly string[];
  nameOf: (assignee: WorkflowAssignee) => string;
}

export function WorkflowNotices({
  workflow,
  settings,
  staleStages,
  nameOf,
}: WorkflowNoticesProps): React.JSX.Element | null {
  const unheld = unheldPermissions(workflow, settings);
  const partly = partlyHeldPermissions(workflow, settings);
  if (unheld.length === 0 && staleStages.length === 0 && partly.length === 0) {
    return null;
  }
  return (
    <div className="space-y-3">
      {unheld.map(({ permission, steps }) => {
        const names = listPhrase(steps.map(step => step.label));
        return (
          <Alert key={permission} variant="destructive" role="alert">
            <AlertTriangle aria-hidden="true" className="size-4" />
            <AlertTitle>No role can take {names} yet</AlertTitle>
            <AlertDescription>
              No role holds{" "}
              <code className="rounded bg-muted px-1 text-xs">
                {permission}
              </code>{" "}
              on {attachmentsPhrase(workflow)}, so only super admins can take{" "}
              {names}. Give a role &ldquo;{permission}&rdquo; under Who takes
              each step.
            </AlertDescription>
          </Alert>
        );
      })}
      {staleStages.map(stage => {
        const reviewer = settings.defaultReviewers[stage];
        const primary = primaryStepOf(workflow, stage);
        if (!reviewer || !primary) return null;
        return (
          <Alert key={stage} variant="warning" role="status">
            <AlertTriangle aria-hidden="true" className="size-4" />
            <AlertDescription>
              The default reviewer of {stageLabel(workflow, settings, stage)},{" "}
              {nameOf(reviewer)}, no longer holds {primary.label}. Choose
              another default reviewer, or give them {primary.label} again.
            </AlertDescription>
          </Alert>
        );
      })}
      {partly.map(({ permission, steps, roles }) => {
        const names = listPhrase(roles.map(role => role.name ?? role.id));
        const taking = listPhrase(steps.map(step => step.label));
        return (
          <Alert key={permission} variant="info" role="status">
            <Info aria-hidden="true" className="size-4" />
            <AlertDescription>
              {names} {roles.length === 1 ? "holds" : "hold"} {taking} on some
              collections only. Saving who takes {taking} takes it from{" "}
              {roles.length === 1 ? "that role" : "those roles"} unless ticked.
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
