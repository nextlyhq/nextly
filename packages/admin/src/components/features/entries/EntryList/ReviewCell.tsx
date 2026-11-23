"use client";

/**
 * ReviewCell: one row's place in its workflow, in the entry list's Review column.
 *
 * Each part with a stage is drawn as its stage's pill, a language part naming its language, so a
 * document whose languages stand apart says which stands where. Beside them, whom the first one
 * waits for and when it is due. A document with nothing waiting to go live says so in words.
 * What it shows is each row's `_review`, which the list read places as the document's own review
 * read does, so the column and the editor never disagree.
 *
 * @module components/features/entries/EntryList/ReviewCell
 */

import type { JSX } from "react";

import { StagePill } from "@admin/components/features/settings/workflows/StagePill";
import type { RowPartReview } from "@admin/types/workflows";

import { waitingForWords } from "../review/review-words";

/** Each listed part as a row's `_review` carries it, or none where the row has no review state. */
export function rowReviewParts(row: Record<string, unknown>): RowPartReview[] {
  const review = row._review as { parts?: unknown } | undefined;
  return Array.isArray(review?.parts) ? (review.parts as RowPartReview[]) : [];
}

export function ReviewCell({
  parts,
}: {
  parts: readonly RowPartReview[];
}): JSX.Element {
  const staged = parts.filter(
    (part): part is RowPartReview & { stage: string } => part.stage !== null
  );
  if (staged.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">Nothing to review</span>
    );
  }
  const first = staged[0];
  const waitingFor = waitingForWords(first.waitingFor);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {staged.map(part => (
          <StagePill
            key={part.part ?? "*"}
            label={
              part.part === null
                ? (part.stageLabel ?? part.stage)
                : `${part.stageLabel ?? part.stage} (${part.part.toUpperCase()})`
            }
            colour={part.stageColour}
          />
        ))}
      </div>
      {waitingFor || first.dueAt ? (
        <span className="text-xs text-muted-foreground">
          {waitingFor ? `Waiting for ${waitingFor}` : null}
          {waitingFor && first.dueAt ? " · " : null}
          {first.dueAt
            ? `Due ${new Date(first.dueAt).toLocaleDateString()}`
            : null}
        </span>
      ) : null}
    </div>
  );
}
