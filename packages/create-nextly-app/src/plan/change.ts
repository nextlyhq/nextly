import { databaseFor } from "./resolve";
import type { PlanAnswers, SetupDraft } from "./values";

/**
 * The answers whose defaults follow from each answer. When that answer
 * changes they go back to their defaults, worked out again from the new
 * answer: where it runs decides the database and images, and the start
 * decides the features.
 */
const DEPENDENTS: Partial<
  Record<keyof PlanAnswers, readonly (keyof PlanAnswers)[]>
> = {
  host: ["db", "images"],
  start: ["features"],
};

/**
 * The draft with one answer changed, as going back to a question or
 * "Change" on the review does. The answers that depend on it are cleared,
 * so they take their new defaults when the plan is resolved, and the
 * connection string is cleared whenever the database it was typed for is
 * no longer the one the draft resolves to, whether the database itself
 * changed or a reset moved it. An answer given again unchanged (a set in
 * any order) resets nothing. The draft passed in is left as it was.
 *
 * @experimental
 */
export function changeAnswer<K extends keyof PlanAnswers>(
  draft: SetupDraft,
  key: K,
  value: PlanAnswers[K]
): SetupDraft {
  if (sameAnswer(draft.answers[key], value)) return draft;
  const answers: PlanAnswers = { ...draft.answers, [key]: value };
  for (const dependent of DEPENDENTS[key] ?? []) delete answers[dependent];
  const next: SetupDraft = { ...draft, answers };
  if (databaseFor(answers) !== databaseFor(draft.answers)) {
    delete next.connectionString;
  }
  return next;
}

/** Equal values, with lists compared as sets. */
function sameAnswer(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every(value => b.includes(value));
  }
  return a === b;
}
