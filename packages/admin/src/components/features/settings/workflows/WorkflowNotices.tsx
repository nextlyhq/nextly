"use client";

/**
 * What needs an admin's attention on a workflow, above its settings:
 * - a step no role holds (only super admins can take it): an alert;
 * - a default reviewer who no longer holds their stage's primary step, a
 *   person or a role, as the server answers it: a warning, announced politely;
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
  type StaleReviewer,
} from "./workflow-settings-model";

/** Why a default reviewer no longer holds their step, as a clause. */
const WHY: Record<StaleReviewer["answer"], (step: string) => string> = {
  lacks: step => `no longer holds ${step}`,
  deactivated: () => "is deactivated",
  "not-found": () => "no longer exists",
};

export interface WorkflowNoticesProps {
  workflow: WorkflowSummary;
  settings: WorkflowSettingsView;
  /** The default reviewers who no longer hold their stage's primary step, and why. */
  stale: readonly StaleReviewer[];
  nameOf: (assignee: WorkflowAssignee) => string;
}

export function WorkflowNotices({
  workflow,
  settings,
  stale,
  nameOf,
}: WorkflowNoticesProps): React.JSX.Element | null {
  const unheld = unheldPermissions(workflow, settings);
  const partly = partlyHeldPermissions(workflow, settings);
  if (unheld.length === 0 && stale.length === 0 && partly.length === 0) {
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
      {stale.map(({ stage, answer }) => {
        const reviewer = settings.defaultReviewers[stage];
        const step = primaryStepOf(workflow, stage)?.label ?? "its step";
        if (!reviewer) return null;
        return (
          <Alert key={stage} variant="warning" role="status">
            <AlertTriangle aria-hidden="true" className="size-4" />
            <AlertDescription>
              The default reviewer of {stageLabel(workflow, settings, stage)},{" "}
              {nameOf(reviewer)}, {WHY[answer](step)}. Choose another default
              reviewer{answer === "lacks" ? `, or give them ${step} again` : ""}
              .
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
