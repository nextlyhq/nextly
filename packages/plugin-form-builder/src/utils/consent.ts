/**
 * A consent field's answer: whether the visitor agreed, kept with the text the
 * form showed them. The text comes from the form at the moment of submission,
 * never from the visitor, and a submitted consent is never edited, so the
 * stored answer says exactly what this visitor agreed to.
 *
 * @module utils/consent
 */

import type { AnyFormField, ConsentAnswer, ConsentFormField } from "../types";

/** Said when an edit of a submission would change a consent. */
export const CONSENT_EDIT_REFUSED =
  "A consent cannot be edited: it keeps what the visitor agreed to";

/** Whether a value is a stored consent answer. */
export function isConsentAnswer(value: unknown): value is ConsentAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const answer = value as Record<string, unknown>;
  return typeof answer.agreed === "boolean" && typeof answer.text === "string";
}

/**
 * Whether the visitor agreed. Only an explicit yes counts: a box sends `on`,
 * a script `true`; anything else, a stray string included, is not consent.
 */
function agreedIn(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") {
    return value === "true" || value === "1" || value === "on";
  }
  if (isConsentAnswer(value)) return value.agreed;
  return false;
}

/**
 * The answer to store for what the visitor sent. The text is the form's, so a
 * visitor who posts an answer object with a text of their own still stores
 * the text the form shows.
 */
export function consentAnswerOf(
  value: unknown,
  field: ConsentFormField
): ConsentAnswer {
  return { agreed: agreedIn(value), text: field.agreementText };
}

function sameConsent(before: unknown, after: unknown): boolean {
  if (before === undefined) return after === undefined;
  if (!isConsentAnswer(before) || !isConsentAnswer(after)) return false;
  return before.agreed === after.agreed && before.text === after.text;
}

/**
 * The answers of a stored submission that are consents: each consent field
 * of the form, and any answer stored as a consent whose field the form no
 * longer has. Read from the submission as well as the form, since a form can
 * lose its consent field while its submissions keep what was agreed to.
 */
export function storedConsentNames(
  fields: readonly AnyFormField[],
  stored: Record<string, unknown>
): string[] {
  const onForm = new Set(fields.map(field => field.name));
  const names = fields
    .filter(field => field.type === "consent")
    .map(field => field.name);
  for (const [name, value] of Object.entries(stored)) {
    if (!onForm.has(name) && isConsentAnswer(value)) names.push(name);
  }
  return names;
}

/**
 * The consents whose stored answer an edit would change: the edit's answers
 * against the stored ones, for each consent the submission holds. One left
 * out of the edit is a change too, since it would drop the answer.
 */
export function editedConsents(
  fields: readonly AnyFormField[],
  stored: Record<string, unknown>,
  edited: Record<string, unknown>
): string[] {
  return storedConsentNames(fields, stored).filter(
    name => !sameConsent(stored[name], edited[name])
  );
}

/** Said when the builder is asked to make a consent optional. */
export const CONSENT_REQUIRED_REASON =
  "A consent is always required: an answer nobody has to give records nothing";

/**
 * A field as the builder keeps it after an edit, or why the edit is refused.
 * A consent stays required, so turning Required off is refused and said; a
 * field just made a consent becomes required, with a text to agree to.
 */
export function consentFieldEdit(
  before: AnyFormField,
  after: AnyFormField
): { field: AnyFormField } | { refused: string } {
  if (after.type !== "consent") return { field: after };
  if (before.type === "consent" && after.required !== true) {
    return { refused: CONSENT_REQUIRED_REASON };
  }
  const text = (after as { agreementText?: unknown }).agreementText;
  return {
    field: {
      ...after,
      required: true,
      agreementText:
        typeof text === "string" ? text : "I agree to the privacy policy",
    } as ConsentFormField,
  };
}

/** Said when a consent has no text to agree to. */
export const CONSENT_TEXT_REQUIRED =
  "A consent field needs the text the visitor agrees to.";

/**
 * The consent fields with no text to agree to. A consent with a blank text
 * would record agreement to nothing, so a form holding one is not saved, by
 * the builder or any other door.
 */
export function blankConsentFields(
  fields: readonly AnyFormField[]
): ConsentFormField[] {
  return fields.filter(
    (field): field is ConsentFormField =>
      field.type === "consent" &&
      (typeof (field as { agreementText?: unknown }).agreementText !==
        "string" ||
        (field as ConsentFormField).agreementText.trim() === "")
  );
}
