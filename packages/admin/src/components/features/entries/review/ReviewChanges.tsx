"use client";

/**
 * The changes a reviewer is asked to judge, shown on the document they are
 * reviewing: the part's newest saved version against its last approval, or,
 * where it has none, its last published version. Drawn with the history's own
 * comparison, so a reviewer reads a change exactly as the history shows it.
 *
 * Shown only where the part waits for this person: one of its steps is an
 * approval or a request for changes they may take. The header carries the
 * steps themselves.
 *
 * @module components/features/entries/review/ReviewChanges
 */

import { Button } from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import { VersionDiffView } from "@admin/components/features/versions/diff/VersionDiffView";
import { useVersions } from "@admin/hooks/queries/useVersions";
import { cn } from "@admin/lib/utils";
import type { VersionScope } from "@admin/services/versionApi";
import type { PartReview } from "@admin/types/workflows";

import { reviewPair, type ReviewPair } from "./review-pair";

export interface ReviewChangesProps {
  /** The document, as the history names it. */
  scope: VersionScope;
  /** The part on screen. */
  part: PartReview | undefined;
  /** The editor's column inset, as the title above uses. */
  className?: string;
}

/** Whether the part waits for this person to judge it. */
function waitsForReviewBy(part: PartReview | undefined): boolean {
  return (
    part !== undefined &&
    part.steps.some(
      step =>
        (step.kind === "approve" || step.kind === "request-changes") &&
        step.mayTake
    )
  );
}

/** What the card says the comparison is against. */
function sinceWords(pair: ReviewPair): string {
  switch (pair.kind) {
    case "pair":
      return pair.since === "approved"
        ? "Changes since the approved version."
        : "Changes since the published version.";
    case "first":
      return "Nothing was published or approved before: all of it is new.";
    case "unchanged":
      return "Nothing changed since it was approved.";
    case "none":
      return "Nothing has been saved yet.";
  }
}

export function ReviewChanges({
  scope,
  part,
  className,
}: ReviewChangesProps): JSX.Element | null {
  const waits = waitsForReviewBy(part);
  const [open, setOpen] = useState(true);
  const versions = useVersions({
    scope,
    enabled: waits,
    ...(part?.part == null ? {} : { locale: part.part }),
  });
  if (!waits || part === undefined) return null;
  const listed = versions.data?.pages[0]?.items;
  const pair =
    listed === undefined
      ? undefined
      : reviewPair(listed, part.approval?.versionNo ?? null);
  return (
    <section
      aria-labelledby="review-changes-heading"
      className={cn("mt-3 space-y-2", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="review-changes-heading" className="text-sm font-medium">
          Changes to review
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >
          {open ? "Hide changes" : "Show changes"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {versions.isError
          ? "The changes could not be read."
          : pair === undefined
            ? "Reading the changes…"
            : sinceWords(pair)}
      </p>
      {open && pair?.kind === "pair" ? (
        <VersionDiffView scope={scope} from={pair.from} to={pair.to} />
      ) : null}
    </section>
  );
}
