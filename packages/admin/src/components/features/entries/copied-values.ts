/**
 * The values a copy from another language put into a form, and what its save says of them.
 *
 * A copy fills the form as unsaved edits; nothing is stored until the person saves. The save
 * that follows names, for each field still holding the value a copy put there, the language it
 * was copied from (`_provenance`, `{ origin: "copy", sourceLocale }`), so the server records the
 * value as copied rather than as the person's own translation. A value edited again since is the
 * person's, and claims nothing. Modelled on a restore's sources (`editor-restore`).
 *
 * One tracker per form, found by the form's `control`: the copy action reaches the form through
 * `useFormContext` and the save through the form itself, and both hand over the same control.
 *
 * @module components/features/entries/copied-values
 */

import { sameFormValue } from "../versions/same-form-value";

/** One field's claim: copied from that language, at the version of it the copy read. */
export interface CopyClaim {
  origin: "copy";
  sourceLocale: string;
  /**
   * The document's `_rev` as the copy read the source language. The server compares it with the
   * source as it stands when the copy is saved: a source that moved in between, or a copy that
   * names no version, reads as out of date until it is copied again.
   */
  sourceRevision?: string;
}

/** The copies one form holds. */
export interface CopiedValues {
  /**
   * Note the values a copy from `sourceLocale` just put into the form, and the version of the
   * source it read (`sourceRevision`, the source's `_rev`), when the read gave one.
   */
  record: (
    values: Record<string, unknown>,
    sourceLocale: string,
    sourceRevision?: string
  ) => void;
  /**
   * A save beginning from `current`: each field still holding its copied value, and the language
   * it came from (`claims`); and, once it is stored (`saved`), the copies it began with forgotten.
   * A copy made while the save was on its way is not in it, so the next save still claims it.
   */
  beginSave: (current: Record<string, unknown>) => {
    claims: Record<string, CopyClaim> | undefined;
    saved: () => void;
  };
  /**
   * Forgets every copy: the form now holds another document or language, or was discarded, and a
   * copy kept would be claimed by a save of a document it was never made in.
   */
  clear: () => void;
}

const byForm = new WeakMap<object, CopiedValues>();

/** The copies a form holds, by its control. */
export function copiedValuesFor(control: object): CopiedValues {
  let copies = byForm.get(control);
  if (copies === undefined) {
    copies = createCopiedValues();
    byForm.set(control, copies);
  }
  return copies;
}

function createCopiedValues(): CopiedValues {
  // Each field's latest copy: the value put in, the language it came from, and the version of
  // that language it was read at.
  type Copy = { value: unknown; sourceLocale: string; sourceRevision?: string };
  const copied = new Map<string, Copy>();
  return {
    record(values, sourceLocale, sourceRevision) {
      for (const [name, value] of Object.entries(values)) {
        copied.set(name, { value, sourceLocale, sourceRevision });
      }
    },
    beginSave(current) {
      // The copies this save begins with, each as it was then: a copy of the field made later
      // replaces the entry, so it outlives this save's `saved`.
      const began = new Map(copied);
      const claims: Record<string, CopyClaim> = {};
      for (const [name, entry] of copied) {
        // A value edited again since its copy is the person's own.
        if (sameFormValue(current[name], entry.value)) {
          claims[name] = {
            origin: "copy",
            sourceLocale: entry.sourceLocale,
            ...(entry.sourceRevision !== undefined
              ? { sourceRevision: entry.sourceRevision }
              : {}),
          };
        }
      }
      return {
        claims: Object.keys(claims).length > 0 ? claims : undefined,
        saved() {
          for (const [name, entry] of began) {
            if (copied.get(name) === entry) copied.delete(name);
          }
        },
      };
    },
    clear() {
      copied.clear();
    },
  };
}
