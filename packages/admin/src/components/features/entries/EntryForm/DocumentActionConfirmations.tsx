"use client";

/**
 * The questions a document action asks before it runs: Unpublish, and
 * discarding a working draft.
 *
 * Drawn by the editor that hosts the form, not by the header, because an action
 * can start where there is no header — a plugin's document view replaces the
 * form body without one — and it still has to ask first. One component, so the
 * questions read the same wherever the action started.
 *
 * @module components/features/entries/EntryForm/DocumentActionConfirmations
 */
import type { JSX } from "react";

import { DiscardDraftConfirmDialog } from "./DiscardDraftConfirmDialog";
import { UnpublishConfirmDialog } from "./UnpublishConfirmDialog";
import type { DocumentActionBindings } from "./useDocumentActionBindings";
import type { EntryData } from "./useEntryForm";

export interface DocumentActionConfirmationsProps {
  confirmations: DocumentActionBindings["confirmations"];
  /** The document the questions are about, for its name in them. */
  entry?: EntryData | null;
  /** Whether a write is in flight, which the questions show as progress. */
  isSubmitting?: boolean;
}

export function DocumentActionConfirmations({
  confirmations,
  entry,
  isSubmitting = false,
}: DocumentActionConfirmationsProps): JSX.Element {
  const entryLabel =
    typeof entry?.title === "string" && entry.title.trim().length > 0
      ? entry.title
      : ((entry?.slug as string | undefined) ?? null);
  const { unpublish, discardDraft } = confirmations;

  return (
    <>
      {/* Mounted whatever is drawn beside it, so the question survives
          whichever control asked it. The dialog closes on confirm and the
          mutation's toast reports the result; its loading state is short-lived
          since unpublish is a single-field PATCH. */}
      <UnpublishConfirmDialog
        open={unpublish.open}
        onOpenChange={open => {
          if (!open) unpublish.dismiss();
        }}
        entryLabel={entryLabel}
        onConfirm={() => {
          void unpublish.confirm();
        }}
        isLoading={isSubmitting}
      />

      {/* Discarding a working draft deletes saved-but-unpublished edits, so it
          is confirmed like Unpublish. It stays open, with its progress showing,
          while the discard runs, and closes only once it SUCCEEDS: closing on
          failure would drop the retry context, whose error the mutation's own
          toast has already surfaced. */}
      <DiscardDraftConfirmDialog
        open={discardDraft.open}
        onOpenChange={open => {
          if (!open) discardDraft.dismiss();
        }}
        entryLabel={entryLabel}
        onConfirm={discardDraft.confirm}
        isLoading={isSubmitting}
      />
    </>
  );
}
