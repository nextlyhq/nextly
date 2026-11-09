"use client";

/**
 * A dialog whose content's code is fetched when it first opens, and what it
 * draws until that code has arrived.
 *
 * Opened at once rather than on arrival, so a click is answered on the frame
 * it happens; a failed fetch is said in the same dialog with a way to try
 * again, and the screen underneath stays as it was.
 *
 * @module components/shared/modal-awaiting-code
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "@nextlyhq/ui";
import type { JSX } from "react";
import { useState } from "react";

import { Loader2 } from "@admin/components/icons";

import { ModuleLoadFailure } from "./module-load-failure";

/**
 * Whether a dialog has been opened yet. A dialog nothing has opened fetches
 * no code, and one that has stays mounted so that closing it still animates.
 */
export function useHasOpened(open: boolean): boolean {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  return opened || open;
}

/** The dialog as it stands until its content's code has arrived. */
export function ModalAwaitingCode({
  open,
  onOpenChange,
  failure,
  className = "max-h-[90vh] overflow-y-auto",
  size,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  failure: { exhausted: boolean; onRetry: () => void } | null;
  /** The real dialog's own sizing, so nothing moves when it replaces this. */
  className?: string;
  size?: "xl";
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...(size ? { size } : {})} className={className}>
        <DialogHeader>
          <DialogTitle>{failure ? "Could not open" : "Loading…"}</DialogTitle>
          <DialogDescription className="sr-only">
            The content of this dialog
          </DialogDescription>
        </DialogHeader>
        {failure ? (
          <ModuleLoadFailure
            message="This could not be loaded."
            exhausted={failure.exhausted}
            onRetry={failure.onRetry}
          />
        ) : (
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
