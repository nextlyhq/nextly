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

/** Whether two sets hold the same names. */
function sameNames(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every(name => b.has(name));
}

/**
 * The names of the fields a condition hides. A condition reads the answers of
 * fields that are themselves shown, so a hidden field's leftover answer never
 * keeps another condition true, and it may read a field before or after its
 * own: the answer is worked out again until it stops changing, at most once
 * per field, which settles any chain of conditions whatever the field order.
 * A field of type `hidden` is not one of them: it is sent with every
 * submission, unseen.
 */
export function fieldsHiddenByCondition(
  fields: readonly AnyFormField[],
  answers: Record<string, unknown>
): Set<string> {
  let hidden = new Set<string>();
  for (let pass = 0; pass <= fields.length; pass += 1) {
    const shown = Object.fromEntries(
      Object.entries(answers).filter(([name]) => !hidden.has(name))
    );
    const next = new Set(
      fields
        .filter(
          field =>
            field.conditionalLogic?.enabled === true &&
            !evaluateConditions(field.conditionalLogic, shown)
        )
        .map(field => field.name)
    );
    if (sameNames(next, hidden)) return next;
    hidden = next;
  }
  return hidden;
}
