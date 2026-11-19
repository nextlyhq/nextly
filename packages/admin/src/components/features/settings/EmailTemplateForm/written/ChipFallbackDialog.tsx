/**
 * A chip's own dialog: the text it shows when its variable has no value, and
 * a warning when, with the test data, it would show nothing at all.
 *
 * @module components/features/settings/EmailTemplateForm/written/ChipFallbackDialog
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

import { AlertTriangle } from "@admin/components/icons";

export function ChipFallbackDialog({
  open,
  onOpenChange,
  name,
  fallback,
  hasTestValue,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chip's friendly name. */
  name: string;
  fallback: string | undefined;
  /** Whether the test data gives the variable a value. */
  hasTestValue: boolean;
  /** The new fallback, or undefined to have none. */
  onSave: (fallback: string | undefined) => void;
}): JSX.Element {
  const id = useId();
  const [draft, setDraft] = useState(fallback ?? "");
  // Each opening starts from the chip's fallback as it is now.
  useEffect(() => {
    if (open) setDraft(fallback ?? "");
  }, [open, fallback]);
  const showsNothing = !hasTestValue && draft === "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            The fallback shows when this has no value: when it is missing, null
            or empty. A value of false or 0 still shows.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={event => {
            event.preventDefault();
            onSave(draft === "" ? undefined : draft);
            onOpenChange(false);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor={id}>Fallback</Label>
            <Input
              id={id}
              value={draft}
              maxLength={500}
              placeholder="For example: there"
              onChange={event => setDraft(event.target.value)}
            />
          </div>
          {showsNothing ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-surface p-2 text-sm text-warning-text"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              No test value and no fallback: this shows nothing in the preview,
              and in any email sent without it.
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">Save fallback</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
