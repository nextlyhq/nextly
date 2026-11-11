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

/** The names a field's enabled condition reads; none when it has none. */
function namesRead(field: AnyFormField): string[] {
  const logic = field.conditionalLogic;
  return logic?.enabled === true
    ? logic.conditions.map(condition => condition.field)
    : [];
}

/**
 * Which of a form's fields its conditions hide, for a given set of answers.
 *
 * A condition reads the answers of fields that are themselves shown, so a
 * hidden field's leftover answer never decides another field, and it may read
 * a field before or after its own. Fields are decided in the order their
 * conditions depend on each other, whatever their order on the form.
 *
 * Conditions can read each other in a loop (A shown when B is answered, B
 * shown when A is), and no order settles a loop. The rule for one: fields in
 * the same loop read each other's answers as given, and only the loop's
 * fields decide it, so an unrelated field elsewhere on the form never changes
 * the outcome.
 *
 * A field of type `hidden` is not one of them: it is sent with every
 * submission, unseen.
 */
export function fieldsHiddenByCondition(
  fields: readonly AnyFormField[],
  answers: Record<string, unknown>
): Set<string> {
  const byName = new Map(fields.map(field => [field.name, field]));
  const reach = new Map<string, Set<string>>();
  /** Every field `name`'s condition depends on, directly or through others. */
  const dependsOn = (name: string): Set<string> => {
    const known = reach.get(name);
    if (known) return known;
    const found = new Set<string>();
    reach.set(name, found);
    const pending = [name];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      const field = byName.get(next);
      for (const read of field ? namesRead(field) : []) {
        if (!found.has(read)) {
          found.add(read);
          pending.push(read);
        }
      }
    }
    return found;
  };

  const shown = new Map<string, boolean>();
  /** Whether field `name` is on the page, deciding what it reads first. */
  const isShown = (name: string): boolean => {
    const decided = shown.get(name);
    if (decided !== undefined) return decided;
    const field = byName.get(name);
    const logic = field?.conditionalLogic;
    if (!field || logic?.enabled !== true) return true;
    // A field read from inside this one's loop counts as given; any other is
    // decided first, which ends: it cannot lead back here.
    const read = Object.fromEntries(
      Object.entries(answers).filter(
        ([other]) =>
          !byName.has(other) ||
          !namesRead(field).includes(other) ||
          dependsOn(other).has(name) ||
          isShown(other)
      )
    );
    const result = evaluateConditions(logic, read);
    shown.set(name, result);
    return result;
  };

  return new Set(
    fields.filter(field => !isShown(field.name)).map(field => field.name)
  );
}
