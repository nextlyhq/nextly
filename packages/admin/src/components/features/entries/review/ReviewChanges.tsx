"use client";

/**
 * The changes a reviewer is asked to judge, shown on the document they are
 * reviewing: the part's newest saved version against its last approval, or,
 * where it has none, its last published version. Drawn with the history's own
 * comparison, so a reviewer reads a change exactly as the history shows it.
 *
 * Shown only where a part on screen waits for this person: one of its steps
 * is an approval or a request for changes they may take. The header carries
 * the steps themselves. Where the shared fields wait with the language, each
 * part's changes are shown under its name; where more than one part waits for
 * this person's approval, "Approve all languages" lists them all, each with
 * its changes.
 *
 * @module components/features/entries/review/ReviewChanges
 */

import { Button } from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import { VersionDiffView } from "@admin/components/features/versions/diff/VersionDiffView";
import { cn } from "@admin/lib/utils";
import type { VersionScope } from "@admin/services/versionApi";
import type { PartReview } from "@admin/types/workflows";

import { approveAllOf } from "./approve-all";
import { ApproveAllDialog } from "./ApproveAllDialog";
import { partPairWords, usePartName, usePartPair } from "./part-changes";

export interface ReviewChangesProps {
  /** The document, as the history names it. */
  scope: VersionScope;
  /**
   * The parts on screen, which the header's steps move together: the
   * language being edited, with the shared part where it waits in the same
   * stage.
   */
  parts: readonly PartReview[];
  /**
   * Every part of the document, from which "Approve all languages" lists
   * those waiting for this person's approval. Absent means the parts on
   * screen alone.
   */
  allParts?: readonly PartReview[];
  /** The editor's column inset, as the title above uses. */
  className?: string;
}

/** Whether the part waits for this person to judge it. */
function waitsForReviewBy(part: PartReview): boolean {
  return part.steps.some(
    step =>
      (step.kind === "approve" || step.kind === "request-changes") &&
      step.mayTake
  );
}

export function ReviewChanges({
  scope,
  parts,
  allParts,
  className,
}: ReviewChangesProps): JSX.Element | null {
  const [open, setOpen] = useState(true);
  const [approvingAll, setApprovingAll] = useState(false);
  const nameOf = usePartName();
  const judged = parts.filter(waitsForReviewBy);
  const everyPart = allParts ?? parts;
  const approval = approveAllOf(everyPart);
  // Other languages can wait for this person while the one on screen does
  // not: the card then offers their approval alone.
  if (judged.length === 0 && approval === undefined) return null;
  // Each part is named where more than one is shown: the shared fields'
  // changes are approved with the language's, so they are shown with them.
  const titled = judged.length > 1;
  return (
    <section
      aria-labelledby="review-changes-heading"
      className={cn("mt-3 space-y-2", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="review-changes-heading" className="text-sm font-medium">
          Changes to review
        </h2>
        <div className="flex flex-wrap gap-2">
          {approval === undefined ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setApprovingAll(true)}
            >
              Approve all languages…
            </Button>
          )}
          {judged.length === 0 ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={open}
              onClick={() => setOpen(value => !value)}
            >
              {open ? "Hide changes" : "Show changes"}
            </Button>
          )}
        </div>
      </div>
      {judged.map(part => (
        <PartChanges
          key={part.part ?? ""}
          scope={scope}
          part={part}
          open={open}
          title={titled ? nameOf(part.part) : null}
        />
      ))}
      {approval === undefined ? null : (
        <ApproveAllDialog
          open={approvingAll}
          onOpenChange={setApprovingAll}
          scope={scope}
          approval={approval}
          parts={everyPart}
        />
      )}
    </section>
  );
}

/** One part's changes: what they are against, and the comparison while open. */
function PartChanges({
  scope,
  part,
  open,
  title,
}: {
  scope: VersionScope;
  part: PartReview;
  open: boolean;
  title: string | null;
}): JSX.Element {
  const read = usePartPair(scope, part, true);
  const { pair } = read;
  return (
    <div className="space-y-2" data-review-changes-part={part.part ?? ""}>
      {title === null ? null : (
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      )}
      <p className="text-xs text-muted-foreground">{partPairWords(read)}</p>
      {open && pair?.kind === "pair" ? (
        <VersionDiffView scope={scope} from={pair.from} to={pair.to} />
      ) : null}
    </div>
  );
}
