"use client";

/**
 * What a document view's screen says when the field it opened for may not be
 * edited: why, and the way back to the document.
 *
 * Said rather than drawn empty, because an address that opens nothing reads as
 * a broken link — and the author arrived by one, typed or shared.
 *
 * @module components/features/entries/EntryForm/DocumentViewFieldRefused
 */
import { Button } from "@nextlyhq/ui";

import type { ViewFieldRefusal } from "./document-view-field-gate";

const REASONS: Record<ViewFieldRefusal, string> = {
  hidden:
    "This field isn't shown for this document as it stands, so it can't be edited here.",
  readOnly: "This field is read-only, so it can't be edited here.",
  disabled: "This field is turned off for editing, so it can't be edited here.",
};

export function DocumentViewFieldRefused({
  reason,
  onExit,
}: {
  reason: ViewFieldRefusal;
  onExit: () => void;
}): React.JSX.Element {
  return (
    <section
      aria-labelledby="document-view-field-refused"
      className="mx-auto flex max-w-md flex-col gap-4 px-6 py-12"
    >
      <h1
        id="document-view-field-refused"
        className="text-lg font-semibold text-foreground"
      >
        {"This field can't be edited"}
      </h1>
      <p className="text-sm text-muted-foreground">{REASONS[reason]}</p>
      <div>
        <Button type="button" variant="outline" onClick={onExit}>
          Back to the document
        </Button>
      </div>
    </section>
  );
}
