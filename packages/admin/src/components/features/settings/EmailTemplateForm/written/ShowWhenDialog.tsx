/**
 * "Show only when": a block shows only when a chosen variable has a value, is
 * yes or is no, as the renderer decides it. The block carries its condition
 * as a label that can be removed.
 *
 * @module components/features/settings/EmailTemplateForm/written/ShowWhenDialog
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@nextlyhq/ui";
import { useEffect, useId, useState, type JSX } from "react";

import type { WrittenBlock } from "@admin/services/emailTemplateApi";

/** A block's condition as stored: a variable and what it must be. */
export type Condition = NonNullable<WrittenBlock["show"]>;

/**
 * What each condition says, as the label and the dialog read it. A value is
 * anything but absent, null, an empty string or an empty list, and 0 is one.
 */
export const WHEN_WORDS: Record<Condition["when"], string> = {
  present: "has a value",
  yes: "is yes",
  no: "is no",
};

/** The order the dialog offers the conditions in. */
const WHENS: readonly Condition["when"][] = ["present", "yes", "no"];

export function ShowWhenDialog({
  open,
  onOpenChange,
  condition,
  choices,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The block's condition now, if it has one. */
  condition: Condition | undefined;
  /** The variables a condition may read, by friendly name. */
  choices: ReadonlyArray<{ path: string; name: string }>;
  onSave: (condition: Condition) => void;
}): JSX.Element {
  const id = useId();
  const [variable, setVariable] = useState("");
  const [when, setWhen] = useState<Condition["when"]>("present");
  // Each opening starts from the block's condition as it is now.
  useEffect(() => {
    if (!open) return;
    setVariable(condition?.variable ?? "");
    setWhen(condition?.when ?? "present");
  }, [open, condition]);
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Show only when</DialogTitle>
          <DialogDescription>
            The block shows only when this is true for the email being sent. A
            value is anything but empty: 0 counts, an empty list does not.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={event => {
            event.preventDefault();
            // A dialog is drawn outside the workbench but sits inside its form in
            // React, where this submit would bubble on and save the whole email.
            event.stopPropagation();
            if (!variable) return;
            onSave({ variable, when });
            close();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-variable`}>Variable</Label>
            <select
              id={`${id}-variable`}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={variable}
              onChange={event => setVariable(event.target.value)}
            >
              <option value="">Choose a variable</option>
              {choices.map(choice => (
                <option key={choice.path} value={choice.path}>
                  {choice.name}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="grid gap-2 text-sm">
            <legend className="mb-1 font-medium">It</legend>
            {WHENS.map(option => (
              <label key={option} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-when`}
                  checked={when === option}
                  onChange={() => setWhen(option)}
                />
                {WHEN_WORDS[option]}
              </label>
            ))}
          </fieldset>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!variable}>
              Save condition
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
