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

import { stripHtmlTags } from "nextly";

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

/**
 * How the plugin's own submit handler says a row is its own.
 *
 * The write-seam check has to be lenient in exactly one case: a honeypot or
 * reCAPTCHA hit is stored flagged rather than dropped, so a false positive stays
 * reviewable, and requiring it to be valid would throw away the thing being
 * reviewed. Deciding that from the row's own `status` made it caller-controlled:
 * the submissions collection grants public create, nothing restricts `status`,
 * so anyone could post `status: "spam"` and switch validation off.
 *
 * A SYMBOL key on the row is the channel, and it is the only one that both
 * reaches the hook and cannot be reached from a request. `JSON.parse` never
 * produces a symbol key, so nothing a caller posts can carry it, and
 * `JSON.stringify` ignores it, so it cannot be stored by accident. It travels
 * with the row it describes, which is what the alternatives could not do.
 *
 * The alternatives were measured, not assumed. `createEntry`'s `params.context`
 * is unreachable: `wrapCollectionsForPlugin` rebuilds the trailing argument as
 * `{ user, overrideAccess }` and drops everything else. `AsyncLocalStorage`
 * reaches the hook but describes the CALL rather than the row, so a submission
 * written by another hook inside the same call took the exception, and
 * identifying the intended row by its content broke as soon as a host hook
 * normalised the payload, since core rebuilds the payload object on the way.
 * A symbol on the row has neither problem: booting a real Nextly and reading
 * the hook's context back, the row's symbol arrives and the payload's does not.
 */
const PLUGIN_SUBMISSION = Symbol.for("nextly.plugin-form-builder.submission");

/** What the handler says about the row it is writing. */
export interface SubmissionOriginMarks {
  /**
   * The handler decided this row is spam and is keeping it as evidence, so the
   * write seam sanitizes it but does not require it to be valid.
   */
  keepAsEvidence: boolean;
  /**
   * The parent form the handler has already read, so the write seam can check
   * the payload against it without reading it again. Used only when its id is
   * the one the row names.
   */
  form?: Record<string, unknown>;
}

/** Mark `row` as this plugin's own write, and hand it back. */
export function asPluginSubmission(
  row: Record<string, unknown>,
  marks: SubmissionOriginMarks
): Record<string, unknown> {
  return Object.defineProperty(row, PLUGIN_SUBMISSION, {
    value: marks,
    enumerable: true,
    configurable: true,
  });
}

/** A row as it looks once this plugin has marked it. */
interface MarkedSubmission {
  [PLUGIN_SUBMISSION]?: SubmissionOriginMarks;
}

/** What this row was marked as, or nothing when it is somebody else's. */
export function submissionMarks(
  row: Record<string, unknown>
): SubmissionOriginMarks | undefined {
  return (row as MarkedSubmission)[PLUGIN_SUBMISSION];
}

/** A form value, compared the way a form value can be. */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => sameValue(value, right[index]))
    );
  }
  return false;
}

/** Whether two submitted payloads say the same thing. */
export function sameSubmittedPayload(
  granted: Record<string, unknown>,
  incoming: Record<string, unknown>
): boolean {
  const answers = Object.entries(granted);
  if (answers.length !== Object.keys(incoming).length) return false;
  return answers.every(([field, answer]) => sameValue(answer, incoming[field]));
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
 * Transform, then sanitize, then validate, in that order and for reasons.
 * Transforming projects the payload onto the declared fields, so an undeclared
 * key never reaches the schema or the row. Sanitizing before validating is what
 * makes every rule judge the value that will actually be stored: the other
 * order let `<b></b>` satisfy a required field and then reduced it to an empty
 * string, and made a length rule count markup the visitor never sees.
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
  sanitizeSubmissionData(transformed, fields);

  if (!validate) {
    return { data: transformed };
  }

  const result = generateZodSchema(fields).safeParse(transformed);
  if (!result.success) {
    // The transformed payload comes back with the errors rather than nothing,
    // so a caller that wants to store it anyway has the same value the valid
    // path would have produced, minus the schema's blessing.
    return { data: transformed, validationErrors: getValidationErrors(result) };
  }

  return { data: result.data };
}
