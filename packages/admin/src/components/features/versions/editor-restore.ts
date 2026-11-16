/**
 * A restore into the editor, and the sources its save names.
 *
 * The chosen values go into the form as unsaved edits and every other edit
 * stays; nothing is stored until the person saves or publishes. Each restore
 * can be undone. The save that follows names, for each field still holding a
 * value a restore put there, the version it came from (`_restoredFrom`): a
 * value edited again or undone first names none. The server checks the same
 * against the version before it records a source.
 *
 * @module components/features/versions/editor-restore
 */

import { sameFormValue } from "./same-form-value";

/** What a restore needs of the form. */
export interface RestorableForm {
  getValues: () => Record<string, unknown>;
  setValue: (
    name: string,
    value: unknown,
    options?: { shouldDirty?: boolean }
  ) => void;
}

/** One restore, which can be undone. */
export interface AppliedRestore {
  undo: () => void;
}

export interface EditorRestore {
  apply: (values: Record<string, unknown>, versionNo: number) => AppliedRestore;
  restoredFromForSave: (
    current: Record<string, unknown>
  ) => Record<string, number> | undefined;
  saved: () => void;
}

export function createEditorRestore(form: RestorableForm): EditorRestore {
  // Each field's latest restore: the value put in, the version it came from,
  // and which restore put it there, so an older Undo leaves a later one be.
  const restored = new Map<
    string,
    { value: unknown; versionNo: number; restore: number }
  >();
  let restores = 0;

  return {
    apply(values, versionNo) {
      const restore = ++restores;
      const before = form.getValues();
      const previous = new Map<string, unknown>();
      for (const [name, value] of Object.entries(values)) {
        previous.set(name, before[name]);
        // An unsaved edit, like any other the person makes.
        form.setValue(name, value, { shouldDirty: true });
        restored.set(name, { value, versionNo, restore });
      }
      return {
        undo() {
          for (const [name, value] of previous) {
            // Only what this restore still holds: a later restore of the
            // field, or the person's own edit since, is theirs to keep.
            if (restored.get(name)?.restore !== restore) continue;
            form.setValue(name, value, { shouldDirty: true });
            restored.delete(name);
          }
        },
      };
    },

    restoredFromForSave(current) {
      const sources: Record<string, number> = {};
      for (const [name, entry] of restored) {
        // A value edited again since its restore carries no source.
        if (sameFormValue(current[name], entry.value)) {
          sources[name] = entry.versionNo;
        }
      }
      return Object.keys(sources).length > 0 ? sources : undefined;
    },

    saved() {
      restored.clear();
    },
  };
}
