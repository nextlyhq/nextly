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

import { sameFieldValue } from "./same-form-value";

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
  /**
   * Put `values` into the form. `typeOf` names each field's type, so whether
   * a field still holds what was put there is asked as the field holds its
   * values: a JSON field's distinct empty values apart, a relationship by the
   * documents it names. A field it names no type for is compared as the form
   * draws it.
   */
  apply: (
    values: Record<string, unknown>,
    versionNo: number,
    typeOf?: (name: string) => string | undefined
  ) => AppliedRestore;
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

/**
 * A field's restore: the value put in, its version, which restore, the
 * field's type, which every later "does it still hold it?" is asked by, and
 * the earlier restore of the field it displaced, which its Undo gives back.
 * The displaced restore is kept here rather than in the Undo, so a reset
 * that keeps this restore can let go of what it displaced.
 */
interface RestoredField {
  value: unknown;
  versionNo: number;
  restore: number;
  type: string | undefined;
  displaced: RestoredField | undefined;
}

/** Whether a field's value now is still the value its restore put there. */
function stillHolds(entry: RestoredField, now: unknown): boolean {
  return sameFieldValue(entry.type, now, entry.value);
}

export function createEditorRestore(form: RestorableForm): EditorRestore {
  // Each field's latest restore: the value put in, the version it came from,
  // and which restore put it there, so an older Undo leaves a later one be.
  const restored = new Map<string, RestoredField>();
  let restores = 0;

  return {
    apply(values, versionNo, typeOf) {
      const restore = ++restores;
      const before = form.getValues();
      // What each field held before, which its Undo puts back.
      const previous = new Map<string, unknown>();
      for (const [name, value] of Object.entries(values)) {
        previous.set(name, before[name]);
        // An unsaved edit, like any other the person makes.
        form.setValue(name, value, { shouldDirty: true });
        restored.set(name, {
          value,
          versionNo,
          restore,
          type: typeOf?.(name),
          displaced: restored.get(name),
        });
      }
      return {
        undo() {
          const now = form.getValues();
          for (const [name, value] of previous) {
            const entry = restored.get(name);
            // Only what this restore still holds: a later restore of the
            // field, a reset since, or the person's own edit since, is theirs
            // to keep.
            if (entry?.restore !== restore) continue;
            if (!stillHolds(entry, now[name])) {
              restored.delete(name);
              continue;
            }
            form.setValue(name, value, { shouldDirty: true });
            // The restore this one displaced holds the field again, with its
            // source and its own Undo, unless a reset since let go of it.
            if (entry.displaced) restored.set(name, entry.displaced);
            else restored.delete(name);
          }
        },
      };
    },

    restoredFromForSave(current) {
      const sources: Record<string, number> = {};
      for (const [name, entry] of restored) {
        // A value edited again since its restore carries no source.
        if (stillHolds(entry, current[name])) {
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
      return entry !== undefined && stillHolds(entry, form.getValues()[name]);
    },

    formReset(current, dirty) {
      for (const [name, entry] of restored) {
        if (!dirty.has(name) || !stillHolds(entry, current[name])) {
          restored.delete(name);
        } else if (entry.displaced) {
          // A restore the reset kept stays, but the one it displaced belongs
          // to the form before the reset: its Undo no longer brings that one
          // back, so neither its source nor its own Undo outlives the reset.
          restored.set(name, { ...entry, displaced: undefined });
        }
      }
    },
  };
}
