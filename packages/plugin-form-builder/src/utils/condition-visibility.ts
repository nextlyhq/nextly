/**
 * Which of a form's fields its conditions hide, for a given set of answers.
 *
 * One answer for every place that needs it: the submission's checks, which
 * must not ask for a field the visitor was never shown, and the admin's
 * preview, which must refuse exactly what the site refuses.
 *
 * @module utils/condition-visibility
 */
import type { AnyFormField } from "../types";

import { evaluateConditions } from "./evaluate-conditions";

/**
 * The names of the fields a condition hides, worked out in field order
 * against the answers of fields that are themselves shown: a hidden field's
 * leftover answer never keeps a later condition true. A field of type
 * `hidden` is not one of them: it is sent with every submission, unseen.
 */
export function fieldsHiddenByCondition(
  fields: readonly AnyFormField[],
  answers: Record<string, unknown>
): Set<string> {
  const shown: Record<string, unknown> = {};
  const hidden = new Set<string>();
  for (const field of fields) {
    const visible =
      !field.conditionalLogic?.enabled ||
      evaluateConditions(field.conditionalLogic, shown);
    if (!visible) {
      hidden.add(field.name);
      continue;
    }
    if (field.name in answers) shown[field.name] = answers[field.name];
  }
  return hidden;
}
