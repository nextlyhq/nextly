"use client";

/**
 * Where the document stands in the language being edited: Draft, Published, or
 * Changed (published, with a working draft waiting to be published).
 *
 * Drawn once, at the start of the document bar, at every width. It reads the
 * status the editor passes for the language being edited, so it never says
 * "Published" beside a Publish button for a translation that lags its default
 * language.
 *
 * @module components/features/entries/EntryForm/DocumentStatusPill
 */

import type { JSX } from "react";

import { cn } from "@admin/lib/utils";

export interface DocumentStatusPillProps {
  /** The status in the language being edited ("draft", "published", ...). */
  status: string;
  /** Whether a published document has a working draft pending. */
  hasWorkingDraft: boolean;
  className?: string;
}

type PillState = "draft" | "published" | "changed";

const PILL_LABEL: Record<PillState, string> = {
  draft: "Draft",
  published: "Published",
  changed: "Changed",
};

/*
 * Monochrome, token-only, and told apart by shape as well as by fill so the
 * three read differently in either colour scheme: a draft is dashed (not out
 * yet), a published document is filled with the muted surface, and a changed
 * one is the card surface with a solid edge — live, with more to come.
 */
const PILL_CLASS: Record<PillState, string> = {
  draft: "border-dashed border-border text-muted-foreground",
  published: "border-transparent bg-muted text-foreground",
  changed: "border-border bg-card text-foreground",
};

export function DocumentStatusPill({
  status,
  hasWorkingDraft,
  className,
}: DocumentStatusPillProps): JSX.Element {
  const isPublished = status === "published";
  // A published entry with a pending working draft is the "Changed" state —
  // the live row stays published while newer edits wait to be promoted.
  const state: PillState =
    isPublished && hasWorkingDraft
      ? "changed"
      : isPublished
        ? "published"
        : "draft";
  return (
    <span
      data-status={state}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold",
        PILL_CLASS[state],
        className
      )}
    >
      {/* The dot takes the pill's own ink, so it needs no colour of its own. */}
      <span
        className="h-1.5 w-1.5 rounded-full bg-current"
        aria-hidden="true"
      />
      {PILL_LABEL[state]}
    </span>
  );
}
