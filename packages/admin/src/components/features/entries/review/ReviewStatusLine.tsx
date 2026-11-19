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
   * Every part of the document, so a request for changes on any of them is
   * shown, the shared part's too. Absent means the part on screen alone.
   */
  parts?: readonly PartReview[];
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
 * What reviewers asked for: one line for each part whose latest move is a
 * request for changes, "Changes requested by Rita: “Shorten the intro.”". A
 * request on another part than the one on screen says where: "on the shared
 * fields", or on that language. The writer reads it on the document they are
 * to change, not only in the side panel.
 */
function changesAskedOf(
  parts: readonly PartReview[],
  onScreen: PartReview | undefined
): { key: string; words: string }[] {
  return parts.flatMap(part => {
    const move = part.lastMove;
    if (move?.kind !== "workflow-request-changes" || move.comment === null) {
      return [];
    }
    const where =
      onScreen !== undefined && part.part === onScreen.part
        ? ""
        : part.part === null
          ? " on the shared fields"
          : ` on ${part.part.toUpperCase()}`;
    return [
      {
        key: part.part ?? "shared",
        words: `Changes requested${where} by ${move.actor.name ?? "a reviewer"}: “${move.comment}”`,
      },
    ];
  });
}

/** A note under the title: a framed line of small text. */
const NOTE =
  "rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground";

export function ReviewStatusLine({
  status,
  hasWorkingDraft,
  part,
  parts,
  className,
}: ReviewStatusLineProps): JSX.Element | null {
  const asked = changesAskedOf(
    parts ?? (part === undefined ? [] : [part]),
    part
  );
  const staged =
    part !== undefined && part.stage !== null
      ? { ...part, stage: part.stage }
      : undefined;
  if (staged === undefined && asked.length === 0) return null;
  return (
    <div className={cn("mt-1 space-y-2", className)}>
      {staged === undefined ? null : (
        <StageWords
          status={status}
          hasWorkingDraft={hasWorkingDraft}
          part={staged}
        />
      )}
      {asked.map(request => (
        <p
          key={request.key}
          role="note"
          // A comment is the reviewer's own text: a long unbroken token
          // wraps rather than widening the column.
          className={cn(NOTE, "break-words [overflow-wrap:anywhere]")}
        >
          {request.words}
        </p>
      ))}
    </div>
  );
}

/** The stage line, and the live strip while a live page's changes wait. */
function StageWords({
  status,
  hasWorkingDraft,
  part,
}: {
  status: string;
  hasWorkingDraft: boolean;
  part: PartReview & { stage: string };
}): JSX.Element {
  const label = part.stageLabel ?? part.stage;
  const live = status === "published";
  // Once its stage allows publishing nobody is waited for: what is left is
  // the publish itself.
  const waiting = part.publishable ? null : waitingForWords(part.waitingFor);
  const words = [
    live ? "Published" : "Draft",
    live ? changesIn(label) : label,
    ...(waiting === null ? [] : [`waiting for ${waiting}`]),
  ];
  return (
    <>
      <p
        className="text-xs text-muted-foreground"
        data-testid="review-status-line"
      >
        {words.join(" · ")}
      </p>
      {live && hasWorkingDraft && !part.publishable ? (
        <p role="note" className={NOTE}>
          Readers see the published version until these changes are approved and
          published.
        </p>
      ) : null}
    </>
  );
}
