/**
 * The link on the selected text: a fixed address, or a variable that holds
 * one, chosen by its friendly name, with the address to use when the variable
 * has none. A link already there can be changed or removed.
 *
 * @module components/features/settings/EmailTemplateForm/written/LinkDialog
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@nextlyhq/ui";
import { useEffect, useId, useState, type JSX } from "react";

import { addressProblem } from "./addresses";
import type { WrittenLink } from "./runs";

/** What the dialog holds while the person edits it. */
interface Draft {
  /** Where the link points: an address typed in, or a variable's value. */
  target: "address" | "variable";
  address: string;
  variable: string;
  /** The address a variable link uses when the variable has none. */
  fallback: string;
}

/** The dialog's starting point: the selection's link as it is now. */
function draftOf(link: WrittenLink | undefined): Draft {
  if (link && "chip" in link) {
    return {
      target: "variable",
      address: "",
      variable: link.chip.variable,
      fallback: link.chip.fallback ?? "",
    };
  }
  return {
    target: "address",
    address: link?.url ?? "",
    variable: "",
    fallback: "",
  };
}

/**
 * The link the draft would save, or why it cannot be saved yet. An address,
 * typed or as a fallback, must be one the server accepts.
 */
function linkOf(draft: Draft): { link?: WrittenLink; problem?: string } {
  if (draft.target === "address") {
    const url = draft.address.trim();
    if (!url) return {};
    const problem = addressProblem(url, "link");
    return problem ? { problem } : { link: { url } };
  }
  if (!draft.variable) return {};
  const fallback = draft.fallback.trim();
  if (!fallback) return { link: { chip: { variable: draft.variable } } };
  const problem = addressProblem(fallback, "link");
  return problem
    ? { problem }
    : { link: { chip: { variable: draft.variable, fallback } } };
}

/**
 * The fields for where the link goes: an address, or a variable with its
 * fallback address. `problemId` names the message about the address, when
 * there is one.
 */
function TargetFields({
  id,
  draft,
  edit,
  choices,
  problemId,
}: {
  id: string;
  draft: Draft;
  edit: (change: Partial<Draft>) => void;
  choices: ReadonlyArray<{ path: string; name: string }>;
  problemId: string | undefined;
}): JSX.Element {
  const invalid = problemId ? true : undefined;
  if (draft.target === "address") {
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-address`}>Address</Label>
        <Input
          id={`${id}-address`}
          inputMode="url"
          placeholder="https://"
          value={draft.address}
          aria-invalid={invalid}
          aria-describedby={problemId}
          onChange={event => edit({ address: event.target.value })}
        />
      </div>
    );
  }
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-variable`}>Variable</Label>
        <select
          id={`${id}-variable`}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={draft.variable}
          onChange={event => edit({ variable: event.target.value })}
        >
          <option value="">Choose a variable</option>
          {choices.map(choice => (
            <option key={choice.path} value={choice.path}>
              {choice.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-fallback`}>Fallback address (optional)</Label>
        <Input
          id={`${id}-fallback`}
          inputMode="url"
          placeholder="https://"
          value={draft.fallback}
          aria-invalid={invalid}
          aria-describedby={problemId}
          onChange={event => edit({ fallback: event.target.value })}
        />
      </div>
    </>
  );
}

export function LinkDialog({
  open,
  onOpenChange,
  link,
  choices,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The link the selection has now, if any. */
  link: WrittenLink | undefined;
  /** The variables a link may take its address from, by friendly name. */
  choices: ReadonlyArray<{ path: string; name: string }>;
  /** The new link, or undefined to remove it. */
  onSave: (link: WrittenLink | undefined) => void;
}): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => draftOf(link));
  // Each opening starts from the selection's link as it is now, fallback
  // included, so saving it unchanged changes nothing.
  useEffect(() => {
    if (open) setDraft(draftOf(link));
  }, [open, link]);
  const edit = (change: Partial<Draft>) =>
    setDraft(current => ({ ...current, ...change }));
  const { link: next, problem } = linkOf(draft);
  const close = () => onOpenChange(false);
  const problemId = `${id}-problem`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{link ? "Edit link" : "Add link"}</DialogTitle>
          <DialogDescription>
            Where the selected text leads: a complete https, http or mailto
            address, or a variable that holds one.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={event => {
            event.preventDefault();
            // A dialog is drawn outside the workbench but sits inside its form in
            // React, where this submit would bubble on and save the whole email.
            event.stopPropagation();
            if (!next) return;
            onSave(next);
            close();
          }}
        >
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="sr-only">The link goes to</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-target`}
                checked={draft.target === "address"}
                onChange={() => edit({ target: "address" })}
              />
              An address
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-target`}
                checked={draft.target === "variable"}
                disabled={choices.length === 0}
                onChange={() => edit({ target: "variable" })}
              />
              A variable
            </label>
          </fieldset>
          <TargetFields
            id={id}
            draft={draft}
            edit={edit}
            choices={choices}
            problemId={problem ? problemId : undefined}
          />
          {problem ? (
            <p id={problemId} className="text-xs text-destructive">
              {problem}
            </p>
          ) : null}
          <DialogFooter className="gap-2">
            {link ? (
              <Button
                type="button"
                variant="outline"
                className="sm:mr-auto"
                onClick={() => {
                  onSave(undefined);
                  close();
                }}
              >
                Remove link
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!next}>
              Save link
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
