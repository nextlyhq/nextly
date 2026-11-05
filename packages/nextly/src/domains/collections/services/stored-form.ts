/**
 * The forms a stored read is made in, and the one question they answer
 * differently.
 *
 * `published` reads the live row; `draft` reads what an editor's preview
 * shows, the pending working draft where there is one. A request's form is
 * parsed against {@link STORED_FORMS} where it arrives, and every branch on a
 * form asks {@link showsUnpublished}, so no third value can slip between two
 * comparisons that each assumed the other form.
 */

import { NextlyError } from "../../../errors/nextly-error";

/** Every form a stored read or a conditional write's expectation may name. */
export const STORED_FORMS = ["published", "draft"] as const;

/** A form a stored read is made in. */
export type StoredForm = (typeof STORED_FORMS)[number];

/**
 * Whether `form` shows unpublished work: the pending working draft, which only
 * a person who may update the document is shown, as a preview is.
 *
 * Exhaustive, and failing closed: a value naming neither form is refused
 * rather than read as either, because a form no branch recognises is one no
 * gate was asked about.
 */
export function showsUnpublished(form: StoredForm): boolean {
  switch (form) {
    case "draft":
      return true;
    case "published":
      return false;
    default:
      return unknownForm(form);
  }
}

/** Refuses a form no branch names; `never` holds every form to a branch. */
function unknownForm(form: never): never {
  throw NextlyError.internal({
    logContext: { reason: "stored-form-unknown", form: String(form) },
  });
}
