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

import type { ViewedVersion } from "@admin/components/features/versions/document-history-context";
import type { UseAutosaveRecoveryResult } from "@admin/hooks/useAutosaveRecovery";
import { cn } from "@admin/lib/utils";

import { formatTimeAgo } from "./time-ago";

export interface AutosaveRecoveryBannerProps {
  /** When the offered recovery point was stored. */
  savedAt: Date;
  /** Write the recovered values into the form. */
  onRestore: () => void;
  /** Stop offering for this session, without deleting anything. */
  onDismiss: () => void;
  className?: string;
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

export interface LiveDocumentRecoveryOfferProps {
  /** The editor's recovery state, from `useAutosaveRecovery`. */
  recovery: UseAutosaveRecoveryResult;
  /** The past version on screen, or null while the live document is. */
  viewingVersion: ViewedVersion | null;
  className?: string;
}

/**
 * The recovery offer, on the one condition every editor surface shows it.
 *
 * Restoring writes into the LIVE form, so the offer is withheld while a past
 * version is on screen — restoring values nobody can see is deciding without
 * seeing — and returns when the live document does. Every surface that hosts
 * a document renders this rather than restating the condition, so the entry
 * editor, the Single editor and a plugin's document view cannot disagree.
 */
export function LiveDocumentRecoveryOffer({
  recovery,
  viewingVersion,
  className,
}: LiveDocumentRecoveryOfferProps) {
  if (viewingVersion !== null || recovery.offer === null) return null;
  return (
    <AutosaveRecoveryBanner
      savedAt={recovery.offer.savedAt}
      onRestore={recovery.restore}
      onDismiss={recovery.dismiss}
      className={className}
    />
  );
}
