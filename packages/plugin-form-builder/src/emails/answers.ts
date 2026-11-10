/**
 * A submission's answers as an email reads them: each by its question's label,
 * a choice by its option's label rather than its stored value, in the form's
 * order.
 *
 * Left out:
 * - questions the visitor did not answer, which includes every question a
 *   condition hid from them, since a hidden question is never submitted;
 * - hidden fields, which carry values the page set for the site's own use,
 *   never something the visitor typed;
 * - files, whose stored value is a media id that means nothing in an inbox;
 *   a notification sends the files themselves as attachments.
 *
 * Everything else is written by `formatExportValue`, the one place a stored
 * answer becomes text, so an email and an export never disagree about it.
 */
import type { AnyFormField } from "../types";
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

/** The answers in a submission, for a notification's `answers` variable. */
export function submissionAnswers(
  fields: readonly AnyFormField[],
  data: Record<string, unknown>
): EmailAnswer[] {
  const answers: EmailAnswer[] = [];
  for (const field of fields) {
    if (field.type === "hidden" || field.type === "file") continue;
    const value = data[field.name];
    if (!isAnswered(value)) continue;
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
