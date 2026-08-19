"use client";

/**
 * A document rendered through the editor's own field components, not editable.
 *
 * Two surfaces need this and want it for the same reason: a past version is the
 * document as it was, and a translation source is the document in another
 * language. Neither is a different KIND of thing from the document being
 * edited, so neither gets a second renderer deciding how a field looks —
 * `FieldRenderer` resolves its `control` from form context, so supplying a
 * different context is the whole mechanism, and every field type already
 * honours `readOnly`.
 *
 * ## Three layers, and only the third is a boundary
 *
 * Worth stating precisely, because the obvious reading of this file is that the
 * `disabled` below makes the document unwritable, and it does not.
 *
 * 1. **`readOnly` is a CONTRACT**, honoured by each field component. Every core
 *    type honours it. It is not a boundary: it depends on the participant, and a
 *    participant has already failed — `plugin-page-builder`'s blocks field
 *    declared only `{ name, control }`, dropped the flag, and offered a live
 *    "Edit blocks" button on a past version until #1043 fixed it.
 * 2. **`disabled` is defence in depth** for registered inputs. It does NOT stop
 *    a programmatic write: measured against RHF 7.66, a `field.onChange` through
 *    `useController` lands on a `disabled: true` form exactly as it does on an
 *    enabled one. `ReadOnlyDocumentForm.boundary.test.tsx` records that, with a
 *    control, so nobody reads this line as a guarantee.
 * 3. **Isolation is the boundary.** The form is constructed here, never
 *    returned, and no save affordance is rendered inside its provider — so a
 *    stray write has nowhere to go. Nothing outside can read these values, and
 *    that is what makes a field component's misbehaviour harmless rather than
 *    merely unlikely.
 *
 * ## The precondition callers have to respect
 *
 * Layer 3 is the one a caller can break, and breaking it is not obvious:
 * `useFormContext` binds to the NEAREST provider, so a save control placed
 * inside this component would submit THIS document rather than the one being
 * edited. Only a field tree belongs inside.
 *
 * @module components/features/entries/EntryForm/ReadOnlyDocumentForm
 */

import type { FieldConfig } from "nextly/config";
import { useId } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { FieldIdScopeContext } from "@admin/components/features/entries/fields/field-id-scope";

import { EntryFormContent } from "./EntryFormContent";

export interface ReadOnlyDocumentFormProps {
  /** The schema that decides what is shown, and in what order. */
  fields: FieldConfig[];
  /**
   * The values, ALREADY in the shape the form's inputs read.
   *
   * Deliberately not normalised here, because the two callers start from
   * different shapes and only they know which: a version snapshot comes from
   * the persisted row (`snapshotToFormValues`), and a translation source comes
   * from the read model (`getDefaultValues`). A normaliser chosen here would be
   * wrong for one of them, and wrong quietly — a JSON-backed field renders
   * blank rather than erroring.
   */
  values: Record<string, unknown>;
  /**
   * Form mode. `"edit"` by default: both callers show a document that exists,
   * so write-only fields such as password present themselves as they do when
   * editing rather than as they do on a blank create form.
   */
  mode?: "create" | "edit";
  className?: string;
}

export function ReadOnlyDocumentForm({
  fields,
  values,
  mode = "edit",
  className,
}: ReadOnlyDocumentFormProps) {
  // `values`, not `defaultValues`. `defaultValues` is read once per mounted
  // form, so changing which document this shows — a second version, a different
  // source language — while it stays mounted would leave the previous one's
  // fields under the new one's heading. `values` reapplies when it changes,
  // which makes the correct behaviour a property of this component rather than
  // an obligation on every caller to remount it.
  //
  // `disabled` is layer 2 above: it disables the registered inputs, which is
  // worth having, and it is not what stops a write.
  const form = useForm<Record<string, unknown>>({ values, disabled: true });

  // A DOM id scope of its own. A field's id is its path, which is unique in a
  // form and not on a page — so without this every label here would point at
  // the live editor's control of the same name: these fields would lose their
  // accessible name, and clicking a label in a read-only view would move focus
  // into the editable document.
  const idScope = useId();

  return (
    <FieldIdScopeContext.Provider value={idScope}>
      <FormProvider {...form}>
        <EntryFormContent
          fields={fields}
          readOnly
          mode={mode}
          {...(className === undefined ? {} : { className })}
        />
      </FormProvider>
    </FieldIdScopeContext.Provider>
  );
}
