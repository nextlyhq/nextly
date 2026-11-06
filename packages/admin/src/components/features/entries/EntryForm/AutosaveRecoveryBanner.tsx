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
import type { JSX } from "react";

import type { ViewedVersion } from "@admin/components/features/versions/document-history-context";
import type { UseAutosaveRecoveryResult } from "@admin/hooks/useAutosaveRecovery";
import { formatDateTime } from "@admin/lib/dates/format";
import { changerName, type StaleVersion } from "@admin/lib/document-version";
import { cn } from "@admin/lib/utils";

import { formatTimeAgo } from "./time-ago";

export interface AutosaveRecoveryBannerProps {
  /** When the offered recovery point was stored. */
  savedAt: Date;
  /** Write the recovered values into the form. */
  onRestore: () => void;
  /** Stop offering for this session, without deleting anything. */
  onDismiss: () => void;
  /**
   * Whether the changes are from an older version, written over since by
   * someone else or by no one in particular: the offer then says restoring
   * them replaces those changes.
   */
  olderVersion?: boolean;
  /**
   * What changed in the document since the version the point's edits began
   * from: who changed it and when, as a refused save says it. The offer then
   * says so in place of the plain older-version warning.
   */
  changedSince?: StaleVersion;
  /** The point was saved without its starting version, before versions. */
  startingVersionUnknown?: boolean;
  className?: string;
}

/** What an offer from an older version adds, in one place for every surface. */
export const OLDER_VERSION_WARNING =
  "These changes were made to an older version. Restoring them replaces changes made since.";

/** Who changed the document since a point's edits began, as the offer says it. */
function changedSinceSentence(changedSince: StaleVersion): string {
  const { changedBy, changedAt } = changedSince;
  const changed = changedBy
    ? `${changerName(changedBy)} changed the document${
        changedAt ? ` at ${formatDateTime(changedAt)}` : ""
      }.`
    : "The document changed since.";
  return `These edits began from an older version. ${changed} Restoring them replaces those changes.`;
}

/** What an offer of a point saved without its starting version adds. */
const STARTING_VERSION_UNKNOWN =
  "The version these edits began from is unknown.";

export function AutosaveRecoveryBanner({
  savedAt,
  onRestore,
  onDismiss,
  olderVersion = false,
  changedSince,
  startingVersionUnknown = false,
  className,
}: AutosaveRecoveryBannerProps): JSX.Element {
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
      <div className="flex-1 space-y-0.5">
        <p className="text-foreground">
          You have unsaved changes from{" "}
          <span className="font-medium">{formatTimeAgo(savedAt)}</span>.
        </p>
        {changedSince ? (
          <p className="text-muted-foreground">
            {changedSinceSentence(changedSince)}
          </p>
        ) : olderVersion ? (
          <p className="text-muted-foreground">{OLDER_VERSION_WARNING}</p>
        ) : null}
        {startingVersionUnknown ? (
          <p className="text-muted-foreground">{STARTING_VERSION_UNKNOWN}</p>
        ) : null}
      </div>
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
}: LiveDocumentRecoveryOfferProps): JSX.Element | null {
  const offer = liveRecoveryOffer(recovery, viewingVersion);
  if (offer === null) return null;
  return (
    <AutosaveRecoveryBanner
      savedAt={offer.savedAt}
      // Called with nothing: the recovery's restore takes an optional step of
      // its own, and the click's event passed through would become that step.
      onRestore={() => recovery.restore()}
      onDismiss={recovery.dismiss}
      olderVersion={offer.olderVersion}
      {...(offer.changedSince ? { changedSince: offer.changedSince } : {})}
      startingVersionUnknown={offer.startingVersionUnknown}
      className={className}
    />
  );
}

/**
 * The offer a surface may make: none while a past version is on screen, since
 * restoring values nobody can see is deciding without seeing. The one rule the
 * banner and the editor's save chip both follow.
 */
export function liveRecoveryOffer(
  recovery: UseAutosaveRecoveryResult,
  viewingVersion: ViewedVersion | null
): UseAutosaveRecoveryResult["offer"] {
  return viewingVersion === null ? recovery.offer : null;
}
