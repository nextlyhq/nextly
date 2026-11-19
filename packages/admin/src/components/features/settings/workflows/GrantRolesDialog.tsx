"use client";

/**
 * Choosing the roles that hold one step, as an exact set: the roles ticked
 * when saved hold the step's permission on every collection and Single the
 * workflow is attached to, and no other role does. Nothing is hidden that the
 * save would change: a role holding it on some collections only is listed
 * unticked and says that saving takes it from them, and a step sharing its
 * permission with others names them, since they change with it.
 *
 * Starts from the roles holding the step now. A save that meets settings
 * changed meanwhile keeps the dialog open with the roles ticked, so they can
 * be reviewed and saved again.
 */

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@nextlyhq/ui";
import type React from "react";
import { useState } from "react";

import type { Role } from "@admin/types/entities";
import type {
  WorkflowSettingsView,
  WorkflowStepSummary,
  WorkflowSummary,
} from "@admin/types/workflows";

import { listPhrase } from "./workflow-settings-model";

export interface GrantRolesDialogProps {
  workflow: WorkflowSummary;
  settings: WorkflowSettingsView;
  step: WorkflowStepSummary;
  /** The roles that may be given a step: every role but the built-in ones. */
  roles: readonly Role[];
  saving: boolean;
  /** The refused save's message, if the last save of this step was refused. */
  error: string | undefined;
  /** Saves the ticked roles; resolves true once they are saved. */
  onSave: (roleIds: string[]) => Promise<boolean>;
  onClose: () => void;
}

export function GrantRolesDialog({
  workflow,
  settings,
  step,
  roles,
  saving,
  error,
  onSave,
  onClose,
}: GrantRolesDialogProps): React.JSX.Element {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () => new Set(settings.grants[step.name] ?? [])
  );
  const grantable = settings.grantableSteps[step.name];
  const partly = new Map(
    (grantable?.partialRoles ?? []).map(role => [role.id, role])
  );
  const sharing = (grantable?.sharesPermissionWith ?? []).map(
    name => workflow.steps.find(each => each.name === name)?.label ?? name
  );
  const toggle = (id: string, on: boolean) =>
    setTicked(current => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  // Roles the list does not carry are still named, from the settings, so a
  // partial holder is never left out of what the save would change.
  const listed = [
    ...roles.map(role => ({ id: role.id, name: role.roleName || role.name })),
    ...[...partly.values()]
      .filter(role => !roles.some(each => each.id === role.id))
      .map(role => ({ id: role.id, name: role.name ?? role.id })),
  ];
  const attachments = listPhrase([
    ...workflow.collections,
    ...workflow.singles,
  ]);

  return (
    <Dialog
      open
      onOpenChange={open => {
        // Held open while saving, so the answer lands where it was asked.
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Who takes {step.label}</DialogTitle>
          <DialogDescription>
            The roles ticked hold{" "}
            <code className="rounded bg-muted px-1 text-xs">
              {grantable?.permission}
            </code>{" "}
            on {attachments}. Super admins hold every step.
          </DialogDescription>
        </DialogHeader>
        {sharing.length > 0 && (
          <p className="text-sm">
            Also changes: {listPhrase(sharing)}, which needs the same
            permission.
          </p>
        )}
        <fieldset className="space-y-2">
          <legend className="sr-only">Roles that take {step.label}</legend>
          {listed.map(role => {
            const id = `grant-${step.name}-${role.id}`;
            const partial = partly.has(role.id);
            return (
              <div key={role.id} className="flex items-start gap-2">
                <Checkbox
                  id={id}
                  checked={ticked.has(role.id)}
                  disabled={saving}
                  onCheckedChange={checked => toggle(role.id, checked === true)}
                  aria-describedby={partial ? `${id}-partial` : undefined}
                />
                <div className="space-y-0.5">
                  <Label htmlFor={id}>{role.name}</Label>
                  {partial && (
                    <p
                      id={`${id}-partial`}
                      className="text-xs text-muted-foreground"
                    >
                      Holds it on some collections only. Saving without it
                      ticked removes it from them; ticked, it is granted
                      everywhere.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </fieldset>
        {error && (
          <p className="text-sm text-danger-text" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => {
              void onSave([...ticked].sort()).then(saved => {
                if (saved) onClose();
              });
            }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
