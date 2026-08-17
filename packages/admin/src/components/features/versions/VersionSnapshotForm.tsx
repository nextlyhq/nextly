/**
 * Renders a stored snapshot through the editor's own field components.
 *
 * A past version is the document as it was, so it is drawn by the same
 * components that draw the document now — read-only. There is no second
 * renderer deciding how a field looks: `FieldRenderer` resolves its `control`
 * from form context, so supplying a different context is the whole mechanism,
 * and all eighteen field types arrive already honouring `readOnly`.
 *
 * The snapshot gets its OWN form instance rather than being reset into the
 * live one, and that is a boundary rather than a preference. Resetting the
 * live form would destroy an editor's unsaved work, and any subsequent dirty
 * flag would let autosave record a historical snapshot as if it were new
 * writing. Neither is guarded against here — a second form makes both
 * unwritable, because the values never enter the form that autosave watches
 * and the submit handler reads.
 *
 * PRECONDITION, and the reason this component renders the field tree and
 * nothing else: `useFormContext` binds to the nearest provider, so anything
 * rendered inside this one silently retargets onto the snapshot. A save
 * affordance placed in here would act on the past. Only `EntryFormContent`
 * belongs inside — verified against every `useFormContext` consumer under
 * `EntryForm/`, none of which is reachable from its subtree.
 *
 * @module components/features/versions/VersionSnapshotForm
 */

import type { FieldConfig } from "nextly/config";
import { useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { EntryFormContent } from "@admin/components/features/entries/EntryForm/EntryFormContent";

import { snapshotToFormValues } from "./snapshot-to-form-values";

export interface VersionSnapshotFormProps {
  /** The document's current schema, which decides what is shown. */
  fields: FieldConfig[];
  /** The stored values for this version. */
  snapshot: unknown;
}

export function VersionSnapshotForm({
  fields,
  snapshot,
}: VersionSnapshotFormProps) {
  // Read into runtime shapes before the inputs see them. A snapshot comes from
  // the persisted row, so a JSON-backed field arrives as text on SQLite and as
  // an object elsewhere; handing the raw value to a control renders a
  // structured field empty instead of showing what it held.
  const values = useMemo(
    () => snapshotToFormValues(fields, snapshot),
    [fields, snapshot]
  );

  // `values`, not `defaultValues`. `defaultValues` is read once per mounted
  // form, so selecting a second version while this stays mounted would leave
  // the previous version's fields under the new version's heading. `values`
  // reapplies when it changes, which makes the correct behaviour a property of
  // this component rather than an obligation on every caller to remount it.
  const form = useForm<Record<string, unknown>>({ values });

  return (
    <FormProvider {...form}>
      {/* `mode="edit"` because a version belongs to a document that exists;
          write-only fields present themselves as they do when editing rather
          than as they do on a blank create form. */}
      <EntryFormContent fields={fields} readOnly mode="edit" />
    </FormProvider>
  );
}
