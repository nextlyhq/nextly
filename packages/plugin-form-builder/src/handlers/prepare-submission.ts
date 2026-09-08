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

import { AsyncLocalStorage } from "node:async_hooks";

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
 * Remove HTML tags from a string, collapse whitespace, and trim.
 *
 * A `<` opens a tag only when what follows it could name one: an ASCII letter,
 * `/` for a closing tag, or `!` and `?` for comments and doctypes. That is the
 * HTML tokenizer's own rule, so what survives here is what a browser would have
 * shown as text anyway. Treating every `<` as a tag cut `2 < 3` down to `2`,
 * which is silent loss in the one column a visitor's own words live in.
 *
 * `<name>` is still removed. Nothing distinguishes it from a tag, and a browser
 * reads it as an unknown element too.
 *
 * A tag left unclosed at end of string is still removed: handed `hello <script`
 * a browser completes it rather than showing it.
 */
function stripHtmlTags(input: string): string {
  return input
    .replace(/<[a-zA-Z/!?][^>]*(?:>|$)/g, "")
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

/**
 * Whether the plugin's own submit handler is the one writing.
 *
 * The write-seam check has to be lenient in exactly one case: a honeypot or
 * reCAPTCHA hit is stored flagged rather than dropped, so a false positive stays
 * recoverable, and requiring it to be valid would throw away the thing being
 * reviewed. Deciding that from the row's own `status` made it caller-controlled:
 * the submissions collection grants public create, nothing restricts `status`,
 * so anyone could post `status: "spam"` and switch validation off.
 *
 * `AsyncLocalStorage` is the mechanism because the question is about the CALL,
 * not about the row. The store follows the await chain into the hook and cannot
 * be reached from a request body, a header or a field. A module-level flag would
 * be the same idea and wrong: two submissions in flight would read each other's.
 *
 * Node's own API, and the same one Next.js and OpenTelemetry use for
 * request-scoped context, rather than a channel invented here.
 */
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

/** One marked write, and whether it has already been made. */
interface SubmissionOriginScope {
  marks: SubmissionOriginMarks;
  spent: boolean;
}

const submissionOrigin = new AsyncLocalStorage<SubmissionOriginScope>();

/** Run `write` marked as the plugin's own, so the write seam can trust it. */
export function asPluginSubmission<T>(
  marks: SubmissionOriginMarks,
  write: () => T
): T {
  return submissionOrigin.run({ marks, spent: false }, write);
}

/**
 * The marks for the write being made now, taken once.
 *
 * They describe ONE row, and the scope outlives it: `createEntry` does not
 * resolve until the `afterCreate` hooks have run, so a hook that writes a
 * second submission runs inside the same store and would otherwise inherit an
 * exception granted to the first. Spending them on the first taker is enough,
 * because the row they were granted for reaches `beforeChange` before anything
 * `afterCreate` can start.
 */
export function takeSubmissionMarks(): SubmissionOriginMarks | undefined {
  const scope = submissionOrigin.getStore();
  if (!scope || scope.spent) return undefined;
  scope.spent = true;
  return scope.marks;
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
