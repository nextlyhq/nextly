/**
 * The link on the selected text: a fixed address, or a variable that holds
 * one, chosen by its friendly name. A link already there can be changed or
 * removed.
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

import type { WrittenLink } from "./runs";

/** Where a link points: an address typed in, or a variable's value. */
type Target = "address" | "variable";

/** The link the dialog would save, or undefined while it has none to save. */
function linkOf(
  target: Target,
  address: string,
  variable: string
): WrittenLink | undefined {
  if (target === "address") {
    const url = address.trim();
    return url ? { url } : undefined;
  }
  return variable ? { chip: { variable } } : undefined;
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
  const [target, setTarget] = useState<Target>("address");
  const [address, setAddress] = useState("");
  const [variable, setVariable] = useState("");
  // Each opening starts from the selection's link as it is now.
  useEffect(() => {
    if (!open) return;
    setTarget(link && "chip" in link ? "variable" : "address");
    setAddress(link && "url" in link ? link.url : "");
    setVariable(link && "chip" in link ? link.chip.variable : "");
  }, [open, link]);
  const next = linkOf(target, address, variable);
  const close = () => onOpenChange(false);
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
                checked={target === "address"}
                onChange={() => setTarget("address")}
              />
              An address
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={`${id}-target`}
                checked={target === "variable"}
                disabled={choices.length === 0}
                onChange={() => setTarget("variable")}
              />
              A variable
            </label>
          </fieldset>
          {target === "address" ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-address`}>Address</Label>
              <Input
                id={`${id}-address`}
                inputMode="url"
                placeholder="https://"
                value={address}
                onChange={event => setAddress(event.target.value)}
              />
            </div>
          ) : (
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
          )}
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
