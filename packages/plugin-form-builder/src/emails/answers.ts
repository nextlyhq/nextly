/**
 * A submission's answers as an email reads them: each by its question's label,
 * a choice by its option's label rather than its stored value, in the form's
 * order.
 *
 * Left out:
 * - questions the visitor did not answer;
 * - questions the form's conditions hid, judged from the answers by the same
 *   `evaluateConditions` the form runs, so a value sent for a hidden question
 *   by a client that ignored the condition is never shown as answered;
 * - hidden fields, which carry values the page set for the site's own use,
 *   never something the visitor typed.
 *
 * A file's stored value is a media id that means nothing in an inbox, so a
 * file answer says how many were uploaded and whether they come with the
 * email.
 *
 * Everything else is written by `formatExportValue`, the one place a stored
 * answer becomes text, so an email and an export never disagree about it.
 */
import type { AnyFormField, ConditionalLogic } from "../types";
import { evaluateConditions } from "../utils/evaluate-conditions";
import { formatExportValue } from "../utils/export-formats";

/** One answer, as the starter messages' `answers` loop reads it. */
export interface EmailAnswer {
  label: string;
  value: string;
}

/** Whether a stored answer counts as given. */
function isAnswered(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** A choice field's stored value(s) replaced by its option labels. */
function choiceLabels(field: AnyFormField, value: unknown): unknown {
  const options = (
    field as { options?: Array<{ label: string; value: string }> }
  ).options;
  if (!Array.isArray(options)) return value;
  const label = (v: unknown) =>
    options.find(option => option.value === v)?.label ?? v;
  return Array.isArray(value) ? value.map(label) : label(value);
}

/** A file answer: how many, and whether they come with the email. */
function fileAnswer(field: AnyFormField, value: unknown): string {
  const count = Array.isArray(value) ? value.length : 1;
  const files = count === 1 ? "1 file" : `${count} files`;
  return (field as { attachToEmail?: boolean }).attachToEmail
    ? `${files}, attached`
    : `${files}, uploaded`;
}

/** Whether the form's conditions showed `field` for these answers. */
function wasShown(field: AnyFormField, data: Record<string, unknown>): boolean {
  const logic = (field as { conditionalLogic?: ConditionalLogic })
    .conditionalLogic;
  return evaluateConditions(logic, data);
}

/** The answers in a submission, for a notification's `submission.answers`. */
export function submissionAnswers(
  fields: readonly AnyFormField[],
  data: Record<string, unknown>
): EmailAnswer[] {
  const answers: EmailAnswer[] = [];
  for (const field of fields) {
    if (field.type === "hidden") continue;
    const value = data[field.name];
    if (!isAnswered(value) || !wasShown(field, data)) continue;
    if (field.type === "file") {
      answers.push({
        label: field.label || field.name,
        value: fileAnswer(field, value),
      });
      continue;
    }
    const shown =
      field.type === "select" || field.type === "radio"
        ? choiceLabels(field, value)
        : value;
    answers.push({
      label: field.label || field.name,
      value: formatExportValue(shown, field),
    });
  }
  return answers;
}
