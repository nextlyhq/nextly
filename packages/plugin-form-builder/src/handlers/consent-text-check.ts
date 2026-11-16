/**
 * The save of a form refuses a consent field with no text to agree to. The
 * builder refuses the same before it sends; this holds it for every other way
 * a form is written (the API, an import), since a consent with a blank text
 * would record agreement to nothing.
 *
 * @module handlers/consent-text-check
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import type { AnyFormField } from "../types";
import { blankConsentFields, CONSENT_TEXT_REQUIRED } from "../utils/consent";

/** The saved fields as written: a list, or a JSON string of one. */
function fieldsOf(value: unknown): AnyFormField[] {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  return Array.isArray(decoded) ? (decoded as AnyFormField[]) : [];
}

/** Refuse a form save holding a consent field with a blank agreement text. */
export function refuseBlankConsentText(context: unknown): void {
  const fields = (context as { data?: Record<string, unknown> }).data?.fields;
  if (fields === undefined) return;
  const blank = blankConsentFields(fieldsOf(fields));
  if (blank.length === 0) return;
  throw NextlyError.validation({
    errors: blank.map(field => ({
      path: `fields.${field.name}.agreementText`,
      code: "REQUIRED",
      message: CONSENT_TEXT_REQUIRED,
    })),
  });
}
