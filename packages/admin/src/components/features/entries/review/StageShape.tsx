/**
 * A workflow stage as the admin shows it wherever it names one: its words, with a small shape
 * for the kind of stage it is, so the stage never rests on colour alone. A dashed ring for a
 * stage still being written, a half-filled circle for one in review, a ticked ring for one that
 * allows publishing, and a triangle where changes were asked for. A stage the workflow no longer
 * has never reaches here: the review state reads a part stored in one as the workflow's first
 * stage, so it is drawn as that stage is.
 *
 * The shape is drawn in the text's own colour and hidden from assistive technology: the words
 * are what is read. It is never a control, so a stage reads as a fact and not as something to
 * press.
 *
 * @module components/features/entries/review/StageShape
 */

import type { JSX } from "react";

import { cn } from "@admin/lib/utils";
import type { PartReview } from "@admin/types/workflows";

/** The kinds of stage a shape is drawn for. */
export type StageShapeKind =
  | "drafting"
  | "in-review"
  | "approved"
  | "changes-requested";

/** What a part's shape is read from: its stage, what the stage allows, and its last move. */
export type StagedPart = Pick<
  PartReview,
  "stage" | "publishable" | "steps" | "lastMove"
>;

/**
 * The shape for the stage a part stands in, or null where it stands in none (live, with
 * nothing waiting). Read from what the review state says of the stage rather than from its
 * name, since a workflow names its stages as it likes:
 *
 * - a part sent back with a request for changes, and not moved since, is waiting on them;
 * - a stage that allows publishing has been approved;
 * - a stage with an approval leaving it is in review;
 * - any other stage is still being written.
 */
export function stageShapeOf(part: StagedPart): StageShapeKind | null {
  if (part.stage === null) return null;
  if (
    part.lastMove?.kind === "workflow-request-changes" &&
    part.lastMove.to === part.stage
  ) {
    return "changes-requested";
  }
  if (part.publishable) return "approved";
  if (part.steps.some(step => step.kind === "approve")) return "in-review";
  return "drafting";
}

export interface StageShapeProps {
  shape: StageShapeKind;
  /** The stage in words, as the surface says it ("In review", "Changes in review"). */
  label: string;
  className?: string;
}

/** A stage's words, after the shape for its kind. */
export function StageShape({
  shape,
  label,
  className,
}: StageShapeProps): JSX.Element {
  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      data-stage-shape={shape}
    >
      <StageGlyph shape={shape} />
      <span>{label}</span>
    </span>
  );
}

/** The shape alone, 12px square, in the text's colour. */
function StageGlyph({ shape }: { shape: StageShapeKind }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 12 12"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {shape === "drafting" ? (
        <circle cx="6" cy="6" r="4.5" strokeDasharray="2.2 1.6" />
      ) : null}
      {shape === "in-review" ? (
        <>
          <circle cx="6" cy="6" r="4.5" />
          <path d="M6 1.5a4.5 4.5 0 0 0 0 9z" fill="currentColor" />
        </>
      ) : null}
      {shape === "approved" ? (
        <>
          <circle cx="6" cy="6" r="4.5" />
          <path
            d="M3.9 6.1l1.5 1.5 2.8-3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : null}
      {shape === "changes-requested" ? (
        <path d="M6 1.4l4.9 8.6H1.1z" strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}
