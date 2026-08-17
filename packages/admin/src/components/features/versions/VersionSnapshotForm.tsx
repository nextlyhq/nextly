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
import { useId, useMemo } from "react";
import { FormProvider, useForm } from "react-hook-form";

import { EntryFormContent } from "@admin/components/features/entries/EntryForm/EntryFormContent";
import { FieldIdScopeContext } from "@admin/components/features/entries/fields/field-id-scope";

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
  // A snapshot that is not an object (absent, or a stored primitive) becomes an
  // empty document rather than throwing: every field then renders as it does
  // when it holds nothing, which is the truthful reading of a version that
  // carries no value for it.
  const values = useMemo(
    () =>
      typeof snapshot === "object" && snapshot !== null
        ? (snapshot as Record<string, unknown>)
        : {},
    [snapshot]
  );

  // Keyed by the caller, so a different version mounts a fresh form rather than
  // needing a reset — the panel already remounts this on selection.
  const form = useForm<Record<string, unknown>>({ defaultValues: values });

  // A DOM id scope of its own. A field's id is its path, which is unique in a
  // form and not on a page — so without this every label here would point at
  // the live editor's control of the same name: these fields would lose their
  // accessible name, and clicking a label in a read-only view would move focus
  // into the editable document.
  const idScope = useId();

  return (
    <FieldIdScopeContext.Provider value={idScope}>
      <FormProvider {...form}>
        {/* `mode="edit"` because a version belongs to a document that exists;
            write-only fields present themselves as they do when editing rather
            than as they do on a blank create form. */}
        <EntryFormContent fields={fields} readOnly mode="edit" />
      </FormProvider>
    </FieldIdScopeContext.Provider>
  );
}
