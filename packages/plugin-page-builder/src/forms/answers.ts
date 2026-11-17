/**
 * A post's answers judged against the fields a form describes: names the form
 * does not describe are dropped, and each described field is checked by the
 * same rules a browser applies to its control (required, email, link,
 * number, date, time and the listed options), so a visitor whose browser
 * passed a field is never refused for it here, and a post that skipped the
 * browser is held to what the form showed.
 *
 * Read from the field description alone, the shape the Form block draws
 * from, so what is drawn and what is checked cannot come to differ.
 *
 * A field's `pattern` is not judged here: a pattern is a provider's rule, and
 * a provider checks its own answers.
 *
 * @module forms/answers
 */
import type {
  FormAnswers,
  FormFieldDescription,
} from "@nextlyhq/plugin-sdk/blocks";

/** One refused answer, by the field it names. */
export interface AnswerIssue {
  readonly field: string;
  readonly message: string;
}

/** A field and the answer sent for it, in the form's order. */
export interface CheckedAnswer {
  readonly name: string;
  readonly values: readonly string[];
}

/** What judging a post's answers came to. */
export type CheckedAnswers =
  | { readonly ok: true; readonly answers: readonly CheckedAnswer[] }
  | { readonly ok: false; readonly issues: readonly AnswerIssue[] };

/**
 * The answers to the described fields only, every other name dropped.
 * Shared by both receiving paths: a provider's form is trimmed to what its
 * provider described before the provider is handed the post.
 */
export function describedAnswers(
  fields: readonly FormFieldDescription[],
  answers: FormAnswers
): Map<string, readonly string[]> {
  const kept = new Map<string, readonly string[]>();
  for (const field of fields) {
    const values = answers.get(field.name);
    if (values !== undefined) kept.set(field.name, values);
  }
  return kept;
}

/** Judge `answers` against `fields`, in the order the form lists them. */
export function checkAnswers(
  fields: readonly FormFieldDescription[],
  answers: FormAnswers
): CheckedAnswers {
  const issues: AnswerIssue[] = [];
  const checked: CheckedAnswer[] = [];
  for (const field of fields) {
    const values = (answers.get(field.name) ?? []).filter(
      value => value !== ""
    );
    const problem = fieldProblem(field, values);
    if (problem !== null) {
      issues.push({ field: field.name, message: problem });
      continue;
    }
    checked.push({ name: field.name, values });
  }
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, answers: checked };
}

/**
 * The HTML standard's valid e-mail address, the rule a browser applies to an
 * `email` input.
 */
const EMAIL =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** The HTML standard's valid floating-point number, a `number` input's rule. */
const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A valid date string, `YYYY-MM-DD`. */
const DATE = /^(\d{4,})-(\d{2})-(\d{2})$/;

/** A valid time string, `HH:MM` with optional seconds. */
const TIME = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/;

/** The kinds a browser sends more than one value for. */
const MANY = new Set<FormFieldDescription["kind"]>(["checkbox", "select"]);

/** Why `values` are refused for `field`, or `null` when they are accepted. */
function fieldProblem(
  field: FormFieldDescription,
  values: readonly string[]
): string | null {
  if (values.length === 0) {
    return field.required === true ? "An answer is needed." : null;
  }
  // Only a checkbox group, or a select, sends one name more than once.
  if (values.length > 1 && !(MANY.has(field.kind) && field.options)) {
    return "Only one answer is taken.";
  }
  for (const value of values) {
    const problem = valueProblem(field, value);
    if (problem !== null) return problem;
  }
  return null;
}

/** Why one value is refused for `field`, or `null`. */
function valueProblem(
  field: FormFieldDescription,
  value: string
): string | null {
  if (field.options !== undefined && field.options.length > 0) {
    return field.options.some(option => option.value === value)
      ? null
      : "That isn't one of the choices.";
  }
  switch (field.kind) {
    case "email":
      return EMAIL.test(value) ? null : "Enter an email address.";
    case "url":
      return isAbsoluteUrl(value) ? null : "Enter a full web address.";
    case "number":
      return numberProblem(field, value);
    case "date":
      return isDate(value) ? null : "Enter a date.";
    case "time":
      return TIME.test(value) ? null : "Enter a time.";
    default:
      return null;
  }
}

/** A `number` answer against the grammar and the field's bounds. */
function numberProblem(
  field: FormFieldDescription,
  value: string
): string | null {
  if (!NUMBER.test(value)) return "Enter a number.";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Enter a number.";
  if (field.min !== undefined && number < field.min) {
    return `Enter ${field.min} or more.`;
  }
  if (field.max !== undefined && number > field.max) {
    return `Enter ${field.max} or less.`;
  }
  return null;
}

/** Whether `value` is an absolute URL, as a `url` input requires. */
function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Whether `value` is a real calendar date written `YYYY-MM-DD`. */
function isDate(value: string): boolean {
  const match = DATE.exec(value);
  if (match === null) return false;
  const [, year, month, day] = match.map(Number);
  // `setUTCFullYear` rather than `Date.UTC`, which reads a year below 100 as
  // 19xx and would refuse `0050-01-01`, a date a browser accepts.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
