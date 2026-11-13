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
  /**
   * The form was reset (another language, document or loaded version, or the
   * stored values taken in): only a restore still held as an unsaved edit
   * stays, so the save after it names no source from before it and an Undo
   * writes nothing into what was loaded.
   */
  formReset: (
    current: Record<string, unknown>,
    dirty: ReadonlySet<string>
  ) => void;
  /**
   * Whether a field holds the value a restore put there: work that follows
   * a field's edits, such as a generated slug, leaves it be while it does.
   */
  holds: (name: string) => boolean;
}

/** A field's restore: the value put in, its version, and which restore. */
interface RestoredField {
  value: unknown;
  versionNo: number;
  restore: number;
}

export function createEditorRestore(form: RestorableForm): EditorRestore {
  // Each field's latest restore: the value put in, the version it came from,
  // and which restore put it there, so an older Undo leaves a later one be.
  const restored = new Map<string, RestoredField>();
  let restores = 0;

  return {
    apply(values, versionNo) {
      const restore = ++restores;
      const before = form.getValues();
      // What each field held before: its value, and the earlier restore this
      // one displaced, which its Undo gives back.
      const previous = new Map<
        string,
        { value: unknown; displaced: RestoredField | undefined }
      >();
      for (const [name, value] of Object.entries(values)) {
        previous.set(name, {
          value: before[name],
          displaced: restored.get(name),
        });
        // An unsaved edit, like any other the person makes.
        form.setValue(name, value, { shouldDirty: true });
        restored.set(name, { value, versionNo, restore });
      }
      return {
        undo() {
          const now = form.getValues();
          for (const [name, { value, displaced }] of previous) {
            const entry = restored.get(name);
            // Only what this restore still holds: a later restore of the
            // field, a reset since, or the person's own edit since, is theirs
            // to keep.
            if (entry?.restore !== restore) continue;
            if (!sameFormValue(now[name], entry.value)) {
              restored.delete(name);
              continue;
            }
            form.setValue(name, value, { shouldDirty: true });
            // The restore this one displaced holds the field again, with its
            // source and its own Undo.
            if (displaced) restored.set(name, displaced);
            else restored.delete(name);
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

    holds(name) {
      const entry = restored.get(name);
      return (
        entry !== undefined &&
        sameFormValue(form.getValues()[name], entry.value)
      );
    },

    formReset(current, dirty) {
      for (const [name, entry] of restored) {
        if (!dirty.has(name) || !sameFormValue(current[name], entry.value)) {
          restored.delete(name);
        }
      }
    },
  };
}
