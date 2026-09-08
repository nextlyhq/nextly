/**
 * What a submission has to be before it is stored, wherever it came from.
 *
 * Two things accept a submission. `submitForm` answers `POST
 * /api/forms/:slug/submit`, and `nextly.forms.submit()` is the Direct API a
 * server-side caller reaches through `getNextly()`. The first transformed,
 * validated and sanitized; the second did none of it, so a submission arriving
 * that way was stored with undeclared keys, values that did not match the
 * form's own schema, and markup intact.
 *
 * The rule lives here rather than in either caller because a rule stated in one
 * of two places is a rule the other can disagree with, and the two had already
 * drifted that far apart. `beforeCreate` on the submissions collection now asks
 * this on every write, so a third caller inherits it without knowing it exists.
 *
 * What is NOT here is the spam machinery: the honeypot, the rate limiter and
 * reCAPTCHA are facts about a REQUEST, not about a row. A trusted server
 * importing a thousand submissions would be rate-limited by its own import, and
 * a honeypot field means nothing without a browser to have skipped it. Those
 * stay on the HTTP path.
 */

import type { AnyFormField } from "../types";
import {
  generateZodSchema,
  getValidationErrors,
  transformFormData,
} from "../utils/generate-schema";

/**
 * Form field types that accept free-text string input from end users.
 * These fields can contain HTML injection vectors and must be sanitized.
 *
 * Fields NOT in this set (select, radio, checkbox, number, date, time, file)
 * are constrained by Zod enum/type validation and don't need sanitization.
 */
const TEXT_FORM_FIELDS = new Set([
  "text",
  "email",
  "textarea",
  "phone",
  "url",
  "hidden",
]);

/**
 * Remove all HTML tags from a string, collapse whitespace, and trim.
 *
 * Uses a regex that matches both complete tags (`<b>`) and unclosed tags
 * at end-of-string (`<script`) to prevent browsers from interpreting
 * incomplete markup.
 */
function stripHtmlTags(input: string): string {
  return input
    .replace(/<[^>]*(?:>|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sanitize form submission data by stripping HTML tags from free-text fields.
 *
 * Iterates over the form's field definitions and applies `stripHtmlTags()`
 * to values whose field type is in `TEXT_FORM_FIELDS`. Non-string values
 * and constrained fields (select, radio, checkbox, etc.) are left unchanged.
 *
 * Mutates the data object in place for efficiency.
 *
 * @param data - Validated submission data (mutated in place)
 * @param fields - Form field definitions (used for type-aware dispatch)
 */
export function sanitizeSubmissionData(
  data: Record<string, unknown>,
  fields: AnyFormField[]
): void {
  for (const field of fields) {
    // Plugin field types are not in TEXT_FORM_FIELDS, so they skip naturally.
    if (!TEXT_FORM_FIELDS.has(field.type)) continue;

    const value = data[field.name];
    if (typeof value !== "string") continue;

    data[field.name] = stripHtmlTags(value);
  }
}

/** A submission ready to store, or the reasons it is not. */
export interface PreparedSubmission {
  /** Transformed and sanitized. Present whether or not validation passed. */
  data: Record<string, unknown>;
  /**
   * Field name to its first message, which is the shape `getValidationErrors`
   * already returns and the HTTP handler already answers with. Absent when the
   * submission is storable.
   */
  validationErrors?: Record<string, string>;
}

/**
 * Bring a submission to the shape the form declares.
 *
 * Transform, then validate, then sanitize, in that order and for reasons:
 * transforming projects the payload onto the declared fields, so an undeclared
 * key never reaches the schema or the row; validating before sanitizing means a
 * length rule counts the characters the visitor typed rather than what stripping
 * left behind.
 *
 * `validate: false` is for content the plugin has already decided to keep as
 * evidence. A honeypot hit is stored flagged rather than dropped so a false
 * positive stays recoverable, and requiring it to be valid would throw the
 * evidence away. It is still transformed and sanitized, because a row nobody
 * validated is exactly the one that should not carry markup.
 *
 * Idempotent, which is what lets the write-seam hook run over data the HTTP
 * handler has already prepared: transforming a projected payload projects it
 * again, and stripping tags from text that has none returns it unchanged.
 */
export function prepareSubmission({
  data,
  fields,
  validate,
}: {
  data: Record<string, unknown>;
  fields: AnyFormField[];
  validate: boolean;
}): PreparedSubmission {
  const transformed = transformFormData(data, fields);

  if (!validate) {
    sanitizeSubmissionData(transformed, fields);
    return { data: transformed };
  }

  const result = generateZodSchema(fields).safeParse(transformed);
  if (!result.success) {
    // The transformed payload comes back with the errors rather than nothing,
    // so a caller that wants to store it anyway has the same value the valid
    // path would have produced, minus the schema's blessing.
    sanitizeSubmissionData(transformed, fields);
    return { data: transformed, validationErrors: getValidationErrors(result) };
  }

  sanitizeSubmissionData(result.data, fields);
  return { data: result.data };
}
