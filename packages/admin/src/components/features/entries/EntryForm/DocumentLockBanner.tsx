"use client";

/**
 * Says, above the document, that someone else is in it.
 *
 * A strip rather than a modal, for the reason the recovery offer is one too: the
 * reader can see the document and then decide. A modal would demand an answer
 * about a colleague's editing session before the document could even be read,
 * and the lock is advisory — it exists to tell two people about each other, not
 * to gate the page.
 *
 * The banner carries the explanation because the fields alone cannot. Rendered
 * read-only they are legible but ambiguous: a tinted, uneditable form reads
 * equally as a document this account lacks permission to change. So the sentence
 * names who has it and what can be done about it.
 *
 * @module components/features/entries/EntryForm/DocumentLockBanner
 */

import { Button } from "@nextlyhq/ui";

import { Lock } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import type { DocumentLockNotice } from "./document-lock-affordances";

export interface DocumentLockBannerProps {
  /** Null when there is nothing to say, which the banner answers by rendering nothing. */
  notice: DocumentLockNotice | null;
  /** Claim the document, displacing whoever holds it. */
  onTakeOver: () => void;
  className?: string;
}

/**
 * Tinted only where the reader has lost something.
 *
 * A colleague holding a document they opened first is ordinary, and dressing it
 * as a warning would make the common case look like a fault. Being displaced
 * mid-edit is not ordinary, so that one carries the emphasis.
 */
const TONE_SURFACE: Record<DocumentLockNotice["tone"], string> = {
  held: "border-border bg-muted/50",
  surrendered: "border-primary bg-primary/5",
  unchecked: "border-border bg-muted/50",
};

export function DocumentLockBanner({
  notice,
  onTakeOver,
  className,
}: DocumentLockBannerProps) {
  // Answered here rather than at each call site: two editors mount this, and a
  // question asked in both is a question that can be answered differently in one.
  if (notice === null) return null;

  return (
    // `status`, not `alert`. `alert` interrupts a screen reader mid-sentence,
    // and none of this is urgent enough to cut across what the reader is doing.
    //
    // 🔴 This strip is where the lock is SPOKEN, and `DocumentStatusLive` is
    // deliberately not given a second copy. That region exists so the header has
    // ONE live area rather than one per concern, and its own note says two in a
    // view interrupt each other and that the same sentence must not sit twice in
    // the accessibility tree. A strip that appears is announced when it appears,
    // which is what the recovery offer and the past-version banner beside it
    // already rely on.
    <div
      role="status"
      data-testid="document-lock-banner"
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-md border px-4 py-3 text-sm",
        TONE_SURFACE[notice.tone],
        className
      )}
    >
      <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="flex-1 text-foreground">{notice.message}</p>
      {notice.takeOverLabel ? (
        <Button type="button" size="sm" variant="outline" onClick={onTakeOver}>
          {notice.takeOverLabel}
        </Button>
      ) : null}
    </div>
  );
}
