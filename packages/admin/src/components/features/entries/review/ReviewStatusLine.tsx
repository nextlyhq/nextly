"use client";

/**
 * The line under a document's title that says where it stands in its
 * workflow: "Published · Changes in review · waiting for Editors". While the
 * page is live and its changes wait for approval, a strip under it says what
 * readers see meanwhile.
 *
 * Draws nothing where no workflow holds the part on screen, so a document
 * without one keeps the title block it has always had.
 *
 * @module components/features/entries/review/ReviewStatusLine
 */

import type { JSX } from "react";

import { cn } from "@admin/lib/utils";
import type { PartReview } from "@admin/types/workflows";

import { waitingForWords } from "./review-words";

export interface ReviewStatusLineProps {
  /** The status in the language being edited. */
  status: string;
  /** Whether a published document has changes not live yet. */
  hasWorkingDraft: boolean;
  /** The part on screen, while it stands in a stage; absent otherwise. */
  part: PartReview | undefined;
  /**
   * The editor's column inset, so the line starts where the title above it
   * does rather than at the column's edge.
   */
  className?: string;
}

/** A stage's label as the second half of "Changes …": "Changes in review". */
function changesIn(label: string): string {
  return `Changes ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/**
 * What a reviewer asked for, while the part's latest move is that request:
 * "Changes requested by Rita: “Shorten the intro.”". The writer reads it on
 * the document they are to change, not only in the side panel.
 */
function changesAskedOf(part: PartReview): string | null {
  const move = part.lastMove;
  if (move?.kind !== "workflow-request-changes" || move.comment === null) {
    return null;
  }
  return `Changes requested by ${move.actor.name ?? "a reviewer"}: “${move.comment}”`;
}

export function ReviewStatusLine({
  status,
  hasWorkingDraft,
  part,
  className,
}: ReviewStatusLineProps): JSX.Element | null {
  if (part === undefined || part.stage === null) return null;
  const label = part.stageLabel ?? part.stage;
  const live = status === "published";
  // Once its stage allows publishing nobody is waited for: what is left is
  // the publish itself.
  const waiting = part.publishable ? null : waitingForWords(part.waitingFor);
  const changesAsked = changesAskedOf(part);
  const words = [
    live ? "Published" : "Draft",
    live ? changesIn(label) : label,
    ...(waiting === null ? [] : [`waiting for ${waiting}`]),
  ];
  return (
    <div className={cn("mt-1 space-y-2", className)}>
      <p
        className="text-xs text-muted-foreground"
        data-testid="review-status-line"
      >
        {words.join(" · ")}
      </p>
      {changesAsked === null ? null : (
        <p
          role="note"
          className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground"
        >
          {changesAsked}
        </p>
      )}
      {live && hasWorkingDraft && !part.publishable ? (
        <p
          role="note"
          className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground"
        >
          Readers see the published version until these changes are approved and
          published.
        </p>
      ) : null}
    </div>
  );
}
