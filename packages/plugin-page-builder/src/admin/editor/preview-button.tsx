"use client";

/**
 * Preview, in the editor's top bar.
 *
 * The admin's own Preview for this document, the one its header would offer,
 * in the language being edited. Drawn only where the admin offers one, so the
 * bar never holds a button that opens nothing. An eye and the words, as the
 * header's own Preview: an icon alone is a guess at what it opens. On a
 * narrow bar the words step aside, their tooltip and name staying.
 *
 * The preview renders the saved document only, so with unsaved changes the
 * button saves a draft first and reads "Save and preview": the author sees
 * what the canvas shows. The save is the bar's own Save, offered only where it
 * keeps the work unpublished, so a preview never publishes. Where no such
 * Save is offered (someone who may not save, or a page whose Save would
 * publish it), the button says it shows the saved version.
 *
 * Unavailable while the document is being saved, as the admin's own Preview
 * is: a preview minted mid-save could show the revision before the save.
 *
 * @module admin/editor/preview-button
 */
import {
  type DocumentActions,
  useDocumentActions,
  useDocumentPreview,
} from "@nextlyhq/plugin-sdk/admin";
import { Button, toast } from "@nextlyhq/ui";
import { Eye } from "lucide-react";
import type * as React from "react";

type SaveOutcome = Awaited<
  ReturnType<NonNullable<DocumentActions["saveWithoutPublishing"]>>
>;

/**
 * Saves the draft and answers whether the preview may open; false closes the
 * tab it claimed. A refused or failed save says why, since the preview it
 * stopped would otherwise just vanish.
 */
async function savedFirst(save: () => Promise<SaveOutcome>): Promise<boolean> {
  const outcome = await save();
  if (outcome.ok) return true;
  // An author who said no to a question was not refused, and a save that
  // already told the author needs no second message.
  if (outcome.reason !== "cancelled" && outcome.reported !== true) {
    toast.error("Couldn't save, so the preview didn't open.", {
      description: outcome.message,
    });
  }
  return false;
}

export function PreviewButton(): React.JSX.Element | null {
  const preview = useDocumentPreview();
  const actions = useDocumentActions();
  if (preview === null) return null;

  const saveState = actions?.saveState.kind;
  const save = actions?.saveWithoutPublishing;
  // A failed save leaves the work unstored too, so it is saved first as well.
  const unstored = saveState === "unsaved" || saveState === "failed";
  const label =
    save === undefined
      ? "Preview the saved version"
      : unstored
        ? "Save and preview"
        : "Preview";

  // Handed to the preview rather than awaited here: it runs once the preview
  // has claimed its tab, so the save's round trip does not cost the click its
  // gesture and get the tab blocked.
  const step =
    save !== undefined && unstored ? () => savedFirst(save) : undefined;

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      title={label}
      disabled={saveState === "saving"}
      onClick={() => {
        void (step === undefined ? preview.open() : preview.open(step));
      }}
    >
      <Eye className="size-4" aria-hidden="true" />
      {/* The words give way on a bar narrower than 1400px, as the device
          labels do, and stay the button's name for a screen reader. */}
      <span className="@max-[1400px]/topbar:sr-only">{label}</span>
    </Button>
  );
}
