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
 * ## It also speaks to the HOLDER
 *
 * One strip, both sides of the same claim. A colleague who is locked out may
 * leave word that they are waiting, and the holder is told here — passively,
 * with nothing withheld and no answer required. Deliberately NOT a modal or an
 * `alertdialog`: there is no APG basis for one, that pattern being for urgent
 * interruptions a person must answer, and WCAG 2.2.4 asks that an interruption
 * be postponable. The lease expiring stays the only thing that transfers a
 * document, so there is nothing here to answer.
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
  /** Leave word with the holder that this editor is waiting. Displaces nobody. */
  onRequestAccess: () => void;
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
  // The reader has lost nothing and is being asked for nothing, so it is the
  // quietest surface of the four. Dressed as a warning it would read as a
  // demand, which is the one thing a courtesy notice must not do.
  awaited: "border-border bg-muted/50",
};

export function DocumentLockBanner({
  notice,
  onTakeOver,
  onRequestAccess,
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
      {/*
        The confirmation is TEXT and not a disabled button. A control that stays
        on screen having stopped doing anything is the thing a reader cannot
        tell from one that is broken, and a disabled button announces itself as
        unavailable rather than as done. It sits inside the same `status`
        region, so replacing the button with it is announced -- which is the
        whole answer the person gets, since nothing else about the page changes.
      */}
      {notice.accessRequest?.kind === "sent" ? (
        <p className="text-muted-foreground">{notice.accessRequest.message}</p>
      ) : null}
      {notice.accessRequest?.kind === "offer" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onRequestAccess}
        >
          {notice.accessRequest.label}
        </Button>
      ) : null}
      {notice.takeOverLabel ? (
        <Button type="button" size="sm" variant="outline" onClick={onTakeOver}>
          {notice.takeOverLabel}
        </Button>
      ) : null}
    </div>
  );
}
