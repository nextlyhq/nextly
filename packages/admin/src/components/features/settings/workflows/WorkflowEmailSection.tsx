"use client";

/**
 * Which workflow notifications also send an email. The bell always tells the
 * person named; each switch decides the email for its trigger alone and is
 * saved as it is switched. A switch whose save did not land (the settings
 * moved meanwhile, or the change was refused) keeps the choice on screen, with
 * a Save to send it again, as the other settings keep theirs.
 */

import { Button, Switch } from "@nextlyhq/ui";
import { Bell } from "lucide-react";
import type React from "react";
import { useState } from "react";

import type {
  WorkflowEmailTrigger,
  WorkflowSettingsView,
} from "@admin/types/workflows";

/** Each trigger, in the order shown, with what it says and to whom. */
const EMAIL_TRIGGERS: readonly {
  trigger: WorkflowEmailTrigger;
  label: string;
  to: string;
}[] = [
  {
    trigger: "assigned",
    label: "Assigned for review",
    to: "To the person assigned",
  },
  {
    trigger: "approved",
    label: "Approved",
    to: "To the person who submitted it",
  },
  {
    trigger: "changesRequested",
    label: "Changes requested",
    to: "To the person who submitted it, with the comment",
  },
];

export interface WorkflowEmailSectionProps {
  settings: WorkflowSettingsView;
  canChange: boolean;
  /** The field being saved (`emails.<trigger>`), or null. */
  saving: string | null;
  errors: Record<string, string>;
  /** Saves one trigger's email; resolves true once it is saved. */
  onChange: (trigger: WorkflowEmailTrigger, on: boolean) => Promise<boolean>;
}

export function WorkflowEmailSection({
  settings,
  canChange,
  saving,
  errors,
  onChange,
}: WorkflowEmailSectionProps): React.JSX.Element {
  // Each choice not yet saved, by trigger: shown over the settings read, so a
  // save that meets settings changed meanwhile does not lose it.
  const [pending, setPending] = useState<
    Partial<Record<WorkflowEmailTrigger, boolean>>
  >({});
  const send = (trigger: WorkflowEmailTrigger, on: boolean) => {
    setPending(current => ({ ...current, [trigger]: on }));
    void onChange(trigger, on).then(saved => {
      if (!saved) return;
      setPending(current =>
        Object.fromEntries(
          Object.entries(current).filter(([each]) => each !== trigger)
        )
      );
    });
  };
  return (
    <ul className="divide-y divide-border">
      {EMAIL_TRIGGERS.map(({ trigger, label, to }) => {
        const id = `workflow-email-${trigger}`;
        const stored = settings.emails[trigger];
        const choice = pending[trigger];
        const on = choice ?? stored;
        const unsaved = choice !== undefined && choice !== stored;
        const error = errors[`emails.${trigger}`];
        return (
          <li
            key={trigger}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{to}</p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Bell aria-hidden="true" className="size-3.5" />
              Bell: always
            </span>
            {canChange ? (
              <span className="inline-flex items-center gap-2 text-xs">
                <span aria-hidden="true">Email</span>
                <Switch
                  id={id}
                  checked={on}
                  disabled={saving === `emails.${trigger}`}
                  aria-label={`Email for ${label}`}
                  onCheckedChange={checked => send(trigger, checked)}
                />
                {unsaved && saving !== `emails.${trigger}` && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label={`Save email for ${label}`}
                    onClick={() => send(trigger, on)}
                  >
                    Save
                  </Button>
                )}
              </span>
            ) : (
              <span className="text-xs">Email: {on ? "on" : "off"}</span>
            )}
            {error && (
              <p className="w-full text-xs text-danger-text" role="alert">
                {error}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
