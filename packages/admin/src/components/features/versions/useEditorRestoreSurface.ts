/**
 * The editor's side of a restore, built once for both document editors.
 *
 * A restore puts a version's values into the form as unsaved edits. The
 * history panel lists what it would change against the form as it stands,
 * so it needs the form's values, which fields carry unsaved edits, which the
 * person may change here (the same gates the form draws the field with), and
 * on a translated document which fields are translated and the language being
 * edited. Both editors hand the same surface through the history context.
 *
 * @module components/features/versions/useEditorRestoreSurface
 */

import { isFieldLocalized, type FieldConfig } from "nextly/config";
import { useEffect, useMemo, useRef } from "react";
import type { FieldValues, Path, UseFormReturn } from "react-hook-form";

import { fieldAdminGates } from "../entries/fields/field-admin-gates";

import type { EditorRestoreSurface } from "./document-history-context";
import { createEditorRestore, type EditorRestore } from "./editor-restore";
import { formFieldsOf } from "./snapshot-to-form-values";

/**
 * The restore a form's values go back through: one per form, shared by the
 * history that puts values in and the save that names where they came from.
 */
export function useFormRestore<T extends FieldValues>(
  form: UseFormReturn<T>
): EditorRestore {
  return useMemo(
    () =>
      createEditorRestore({
        getValues: () => form.getValues(),
        setValue: (name, value, options) =>
          form.setValue(name as Path<T>, value as T[Path<T>], options),
      }),
    [form]
  );
}

export function useEditorRestoreSurface<T extends FieldValues>({
  restore,
  form,
  fields,
  readOnly,
  localized,
  language,
  locale,
}: {
  /** The form's restore; see `useFormRestore`. */
  restore: EditorRestore;
  form: UseFormReturn<T>;
  /** The content type's fields, as the form draws them. */
  fields: FieldConfig[];
  /**
   * Whether the whole document is read-only to this person here, read when a
   * restore asks: the editor decides it later in its render than it builds
   * this surface.
   */
  readOnly: () => boolean;
  /** Whether the document is translated. */
  localized: boolean;
  /** The language being edited, by name, on a translated document. */
  language?: string;
  /** The language being edited, by its code. */
  locale?: string;
}): EditorRestoreSurface {
  // The latest answer, read when a restore asks, so a new getter each render
  // does not rebuild the surface every consumer of the history reads.
  const readOnlyNow = useRef(readOnly);
  useEffect(() => {
    readOnlyNow.current = readOnly;
  }, [readOnly]);

  return useMemo(() => {
    const named = new Map(
      formFieldsOf(fields).map(field => [field.name, field])
    );
    const translatable = localized
      ? new Set(
          [...named.values()]
            .filter(field => isFieldLocalized(field, true))
            .map(field => field.name)
        )
      : undefined;
    return {
      restore,
      fields,
      currentValues: () => form.getValues(),
      dirtyFields: () => new Set(Object.keys(form.formState.dirtyFields)),
      // The gates the form draws the field with, under the document's own
      // lock: a field the form would not let them change, a restore does not.
      canEdit: name => {
        const field = named.get(name);
        if (readOnlyNow.current() || !field) return false;
        const gates = fieldAdminGates(field);
        return !gates.readOnly && !gates.disabled;
      },
      ...(translatable ? { translatable } : {}),
      ...(localized && language ? { language } : {}),
      ...(localized && locale ? { locale } : {}),
    };
  }, [restore, form, fields, localized, language, locale]);
}
