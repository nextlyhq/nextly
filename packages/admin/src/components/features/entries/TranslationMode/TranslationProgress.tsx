"use client";

/**
 * How much of THIS language is done, counted as the translator types.
 *
 * Field-level, not document-level. The language panel already answers "how many
 * languages are translated" from the backend's stored map; that number cannot
 * move while someone is working, because it describes what was last saved. A
 * translator part-way through a document needs the other question, and it can
 * only be answered from the form's live values.
 *
 * ## Why it takes a `control` instead of reading form context
 *
 * It renders in the mode bar, which is OUTSIDE the target pane and therefore
 * outside the form's provider — deliberately, since the bar must not contain
 * anything that writes. `useWatch` accepts an explicit control, so this
 * subscribes to the translatable fields directly and re-renders ONLY itself.
 * Watching from the form component instead would re-render the whole editor on
 * every keystroke.
 *
 * @module components/features/entries/TranslationMode/TranslationProgress
 */

import type { FieldConfig } from "nextly/config";
import { useWatch, type Control, type FieldValues } from "react-hook-form";

import { CompletenessMeter } from "../CompletenessMeter";
import { fieldTranslationCounts } from "../translation-meta";

export interface TranslationProgressProps {
  /** The target form's control, passed rather than read from context. */
  control: Control<FieldValues>;
  /**
   * The translatable fields, in document order.
   *
   * Takes the FIELDS and derives their names here rather than taking names,
   * because both editors would otherwise write the same three-line derivation
   * at the call site — which is exactly what they did, and what `fallow`
   * attributed as a clone.
   */
  fields: readonly FieldConfig[];
}

export function TranslationProgress({
  control,
  fields,
}: TranslationProgressProps) {
  const fieldNames = fields
    .map(f => ("name" in f ? f.name : undefined))
    .filter((n): n is string => !!n);

  // Named fields only. A bare `useWatch({ control })` subscribes to the whole
  // form, which would re-render this on every keystroke in a shared field that
  // has nothing to do with the count.
  const values = useWatch({
    control,
    name: fieldNames,
  }) as unknown[];

  const byName: Record<string, unknown> = {};
  fieldNames.forEach((name, i) => {
    byName[name] = values?.[i];
  });
  const { translated, total } = fieldTranslationCounts(fieldNames, byName);

  // A document whose every field is shared has nothing to report, and a "0 of 0"
  // reads as work outstanding rather than as a document with no fields to
  // translate.
  if (total === 0) return null;

  return (
    <span
      className="flex items-center gap-2 text-xs text-muted-foreground"
      // One live region rather than a chatty one per field: a screen-reader user
      // typing gets the running total, not an announcement per keystroke.
      role="status"
      aria-live="polite"
    >
      <CompletenessMeter translated={translated} total={total} />
      <span className="tabular-nums">
        {translated} of {total} fields translated
      </span>
    </span>
  );
}
