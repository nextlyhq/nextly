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

import type { RowAddressRefusal } from "@admin/lib/plugins/field-address";

import type { ViewFieldRefusal } from "./document-view-field-gate";

const REASONS: Record<ViewFieldRefusal | RowAddressRefusal, string> = {
  hidden:
    "This field isn't shown for this document as it stands, so it can't be edited here.",
  readOnly: "This field is read-only, so it can't be edited here.",
  disabled: "This field is turned off for editing, so it can't be edited here.",
  // An address through a repeater's row names the row by its saved id. Each
  // of these is refused rather than opened on whichever row now stands
  // where the named one stood, which would look like the right editor
  // showing another row's content.
  rowGone:
    "The row this link opens isn't in this document any more: it may have been removed. Go back to the document and open the row you want from there.",
  position:
    "This link names a row by its position, which changes when rows are reordered, so it could open the wrong row. Go back to the document and open the row from there.",
  ownIds:
    "This repeater's rows set their own id field, so a row has no saved identity to open it by.",
};

/** Whether a refusal is about the row an address names, not its field. */
function aboutRow(reason: ViewFieldRefusal | RowAddressRefusal): boolean {
  return reason === "rowGone" || reason === "position" || reason === "ownIds";
}

export function DocumentViewFieldRefused({
  reason,
  onExit,
}: {
  reason: ViewFieldRefusal | RowAddressRefusal;
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
        {aboutRow(reason)
          ? "This row can't be opened"
          : "This field can't be edited"}
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
