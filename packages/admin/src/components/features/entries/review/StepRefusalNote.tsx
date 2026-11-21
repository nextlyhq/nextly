"use client";

/**
 * A refused workflow step's reason, said where the step was taken and kept
 * there until dismissed or the next step: a toast alone is gone before a
 * reviewer has read who could approve instead.
 *
 * @module components/features/entries/review/StepRefusalNote
 */

import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import { AlertTriangle } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

export interface StepRefusalNoteProps {
  /** The refusal's words; nothing is drawn without them. */
  refusal: string | null;
  onDismiss?: () => void;
  className?: string;
}

export function StepRefusalNote({
  refusal,
  onDismiss,
  className,
}: StepRefusalNoteProps): JSX.Element | null {
  if (refusal === null) return null;
  return (
    <div
      role="alert"
      // The status text colour, which reads at AA on the page in both schemes;
      // the destructive action's red is lighter than text may be.
      className={cn(
        "mt-2 flex items-start gap-2 text-sm text-danger-text",
        className
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      {/* The refusal names fields and people: long words wrap in place. */}
      <p className="min-w-0 flex-1 break-words">{refusal}</p>
      {onDismiss === undefined ? null : (
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </div>
  );
}
