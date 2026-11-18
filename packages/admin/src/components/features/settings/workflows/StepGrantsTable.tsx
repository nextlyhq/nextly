"use client";

/**
 * Who takes each step: for every step, where it moves a document from and to,
 * the permission it needs, and the roles holding that permission on every
 * collection and Single the workflow is attached to. A step with a permission
 * of its own has "Change", which opens the roles dialog, for a reader who may
 * change grants; any other step needs only the collections' own permissions,
 * granted on each role, and has nothing to change here.
 */

import { Button } from "@nextlyhq/ui";
import { Users } from "lucide-react";
import type React from "react";

import type {
  WorkflowSettingsView,
  WorkflowStepSummary,
  WorkflowSummary,
} from "@admin/types/workflows";

import { listPhrase, stageLabel } from "./workflow-settings-model";

export interface StepGrantsTableProps {
  workflow: WorkflowSummary;
  settings: WorkflowSettingsView;
  /** A role's name by its id. */
  roleName: (id: string) => string;
  /** Whether the reader may change who holds a step. */
  canChange: boolean;
  /** The step whose roles are being saved, whose Change is held meanwhile. */
  saving: boolean;
  /** Each refused setting's message, by field (`grants.<step>`). */
  errors: Record<string, string>;
  /** Opens the roles dialog for a step; it gives focus back to Change on closing. */
  onChange: (step: WorkflowStepSummary) => void;
}

export function StepGrantsTable({
  workflow,
  settings,
  roleName,
  canChange,
  saving,
  errors,
  onChange,
}: StepGrantsTableProps): React.JSX.Element {
  const labelOf = (stage: string) => stageLabel(workflow, settings, stage);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th scope="col" className="py-2 pr-4 font-medium">
              Step
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Permission
            </th>
            <th scope="col" className="py-2 font-medium">
              Roles
            </th>
          </tr>
        </thead>
        <tbody>
          {workflow.steps.map(step => {
            const grantable = settings.grantableSteps[step.name];
            const held = settings.grants[step.name] ?? [];
            const error = errors[`grants.${step.name}`];
            return (
              <tr key={step.name} className="border-b border-border align-top">
                <th scope="row" className="py-3 pr-4 font-medium">
                  <span className="block">{step.label}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {listPhrase(step.from.map(labelOf))} → {labelOf(step.to)}
                  </span>
                </th>
                <td className="py-3 pr-4">
                  {grantable ? (
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {grantable.permission}
                    </code>
                  ) : (
                    <span className="text-muted-foreground">
                      The collection&apos;s own permissions
                    </span>
                  )}
                </td>
                <td className="py-3">
                  {grantable ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {held.length === 0 ? (
                        <span className="text-muted-foreground">
                          No role yet
                        </span>
                      ) : (
                        held.map(id => (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground"
                          >
                            <Users aria-hidden="true" className="size-3" />
                            {roleName(id)}
                          </span>
                        ))
                      )}
                      {canChange && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={saving}
                          aria-label={`Change who takes ${step.label}`}
                          onClick={() => onChange(step)}
                        >
                          Change
                        </Button>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      Granted on each role
                    </span>
                  )}
                  {error && (
                    <p className="mt-1 text-xs text-danger-text" role="alert">
                      {error}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
