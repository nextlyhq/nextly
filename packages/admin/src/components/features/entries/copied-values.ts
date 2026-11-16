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

/** One field's claim: copied from that language. */
export interface CopyClaim {
  origin: "copy";
  sourceLocale: string;
}

/** The copies one form holds. */
export interface CopiedValues {
  /** Note the values a copy from `sourceLocale` just put into the form. */
  record: (values: Record<string, unknown>, sourceLocale: string) => void;
  /** Each field still holding its copied value, and the language it came from. */
  provenanceForSave: (
    current: Record<string, unknown>
  ) => Record<string, CopyClaim> | undefined;
  /** The save is made: what it said is stored, and nothing is claimed again. */
  saved: () => void;
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
  // Each field's latest copy: the value put in, and the language it came from.
  const copied = new Map<string, { value: unknown; sourceLocale: string }>();
  return {
    record(values, sourceLocale) {
      for (const [name, value] of Object.entries(values)) {
        copied.set(name, { value, sourceLocale });
      }
    },
    provenanceForSave(current) {
      const claims: Record<string, CopyClaim> = {};
      for (const [name, entry] of copied) {
        // A value edited again since its copy is the person's own.
        if (sameFormValue(current[name], entry.value)) {
          claims[name] = { origin: "copy", sourceLocale: entry.sourceLocale };
        }
      }
      return Object.keys(claims).length > 0 ? claims : undefined;
    },
    saved() {
      copied.clear();
    },
  };
}
