"use client";

/**
 * Offers the author their own unsaved work back, without blocking the editor.
 *
 * A strip above the form rather than a modal. A modal was right for the older
 * local draft, which was almost always your own work from a tab that had just
 * crashed. A server recovery point is a wider set: it can be work from another
 * device, or from days ago, so demanding an answer before the document can be
 * read turns a rescue into an obstacle. Here the reader sees the document, then
 * decides.
 *
 * @module components/entries/EntryForm/AutosaveRecoveryBanner
 */

import { Button } from "@nextlyhq/ui";
import { RotateCcw, X } from "lucide-react";

import { cn } from "@admin/lib/utils";

export interface AutosaveRecoveryBannerProps {
  /** When the offered recovery point was stored. */
  savedAt: Date;
  /** Write the recovered values into the form. */
  onRestore: () => void;
  /** Stop offering for this session, without deleting anything. */
  onDismiss: () => void;
  className?: string;
}

/** "10 minutes ago", in the coarsest unit that still reads precisely. */
function formatTimeAgo(date: Date): string {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "moments ago";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)
    return diffMin === 1 ? "1 minute ago" : `${diffMin} minutes ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24)
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;

  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
}

export function AutosaveRecoveryBanner({
  savedAt,
  onRestore,
  onDismiss,
  className,
}: AutosaveRecoveryBannerProps) {
  return (
    // `status` rather than `alert`: an offer to recover is advisory, and `alert`
    // interrupts a screen reader mid-sentence for something the reader can act
    // on whenever they choose.
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/50 px-4 py-3 text-sm",
        className
      )}
    >
      <RotateCcw className="h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="flex-1 text-foreground">
        You have unsaved changes from{" "}
        <span className="font-medium">{formatTimeAgo(savedAt)}</span>.
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onRestore}>
          Restore
        </Button>
        {/* Named for assistive technology: an unlabelled X in a region that
            already says "unsaved changes" reads as "button" alone. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          aria-label="Dismiss recovery offer"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
