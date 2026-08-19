"use client";

/**
 * Fill ONE field from the source language.
 *
 * The document-level copy already exists (`useCopyFromLanguage`) and is the
 * wrong grain for this screen: it fills every translatable field at once behind
 * a confirm step, because it is offered where the source is not on display and
 * an author cannot see what they are about to overwrite. Here the source IS on
 * display, immediately beside the field, and the useful gesture is "this one" —
 * a name, a URL, a line that is the same in both languages.
 *
 * No confirm step, for the same reason: the author can see both values, the
 * action names the field it fills, and nothing is saved. Undo is the form's
 * own — the field is dirty until they save, and the unsaved-changes guard
 * already covers leaving.
 *
 * Renders nothing at all unless the field is being translated AND the source
 * actually holds something. An empty source is not a fill worth offering, and a
 * button that blanks the target is the opposite of the intent.
 *
 * @module components/features/entries/TranslationMode/UseSourceButton
 */

import { useFormContext } from "react-hook-form";

import { isFieldTranslated } from "../translation-meta";

import { useTranslationField } from "./TranslationFieldContext";

export function UseSourceButton({
  fieldName,
  fieldLabel,
}: {
  /** The form path this fills — the field's own name. */
  fieldName: string;
  /** For the accessible name, so several of these are told apart. */
  fieldLabel: string;
}) {
  const { sourceValues, sourceLabel } = useTranslationField();
  // Reads the TARGET form, because this renders inside the target pane. The
  // source pane is outside this context entirely, so there is no arrangement in
  // which this writes the wrong document.
  const form = useFormContext();

  const value = sourceValues?.[fieldName];
  if (!sourceValues || !isFieldTranslated(value)) return null;

  return (
    <button
      type="button"
      className="text-xs font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
      // Named for the field it acts on. Read out of context — a screen reader
      // listing this form's controls — a dozen buttons all saying "Use source"
      // name no field at all.
      aria-label={`Use the ${sourceLabel ?? "source"} text for ${fieldLabel}`}
      onClick={() => {
        // `shouldDirty` so the form knows there is something to save, and the
        // unsaved-changes guard sees it; `shouldValidate` so a filled field
        // stops reporting the error it had while empty.
        form.setValue(fieldName, value, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }}
    >
      Use source
    </button>
  );
}
