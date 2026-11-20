/**
 * Convert to code: one way. The dialog says it cannot be undone, shows the
 * code the email becomes when that code is at hand, and converts only the
 * saved email, since its code is written from the blocks as they were saved.
 *
 * @module components/features/settings/EmailTemplateForm/written/ConvertToCodeDialog
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import { AlertTriangle, Loader2 } from "@admin/components/icons";

export function ConvertToCodeDialog({
  open,
  onOpenChange,
  dirty,
  isPending,
  source,
  onConvert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the email has changes not yet saved, which the code would miss. */
  dirty: boolean;
  isPending: boolean;
  /** The HTML the saved blocks are written as, when it is known. */
  source?: string;
  onConvert: () => void;
}): JSX.Element {
  return (
    <Dialog
      open={open}
      // Held open while converting: closed, the editor would take edits the
      // conversion is about to replace.
      onOpenChange={next => {
        if (!isPending) onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Convert to code?</DialogTitle>
          <DialogDescription>
            This can&apos;t be undone: a coded email can&apos;t be turned back
            into blocks. Every variable, condition and list stays as Liquid, so
            each email sent still uses its own recipient&apos;s data.
          </DialogDescription>
        </DialogHeader>
        {source !== undefined ? (
          <pre
            aria-label="The code this email becomes"
            className="max-h-64 overflow-auto rounded-md border border-border bg-muted p-3 text-xs"
          >
            {source}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">
            Its HTML and Liquid are written from the saved blocks and open in
            the code editor once it is converted.
          </p>
        )}
        {dirty ? (
          <p
            role="status"
            className="flex items-start gap-2 rounded-md border border-warning-border bg-warning-surface p-2 text-sm text-warning-text"
          >
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            Save your changes first: the code is written from the saved blocks.
          </p>
        ) : null}
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={dirty || isPending}
            onClick={onConvert}
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Convert to code
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
