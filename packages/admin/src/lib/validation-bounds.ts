/**
 * The numeric validation bounds a field accepts, judged as they stand.
 *
 * One rule, read twice: said under the bound the moment it is typed
 * (`ValidationRulesEditor`), and asked again before a save
 * (`field-validators`), so a bound the panel already says cannot be kept is
 * one the save refuses — never a value the panel flags that quietly saves
 * anyway, and downstream reads its own way.
 */

import type { FieldValidationRule } from "nextly/field-catalog";

/**
 * The rules this vocabulary draws, and what each admits.
 *
 * `counts` is the whole of the difference between a bound on a QUANTITY and a
 * bound on a VALUE: a length or a row count is a whole number of zero or more,
 * while a bound on a value may legitimately be fractional or negative.
 * `ValidationNumberField` turns that one flag into the input's constraints, so
 * every surface applies the same answer rather than restating it.
 *
 * `required` is deliberately absent: every surface offers it through its own
 * control outside this set, so drawing it here would draw it twice.
 */
export const NUMERIC_RULES = {
  minLength: {
    label: "Min length",
    description: "Fewest characters allowed.",
    counts: true,
  },
  maxLength: {
    label: "Max length",
    description: "Most characters allowed.",
    counts: true,
  },
  minRows: {
    label: "Min rows",
    description: "Fewest entries allowed.",
    counts: true,
  },
  maxRows: {
    label: "Max rows",
    description: "Most entries allowed.",
    counts: true,
  },
  min: { label: "Min", description: "Lowest value allowed.", counts: false },
  max: { label: "Max", description: "Highest value allowed.", counts: false },
} as const satisfies Partial<
  Record<
    FieldValidationRule,
    { label: string; description: string; counts: boolean }
  >
>;

export type NumericRule = keyof typeof NUMERIC_RULES;

/**
 * Every rule, in the order the vocabulary presents them: the order a save
 * asks after them, so the first problem found is the first one shown.
 */
export const NUMERIC_BOUND_RULES: readonly NumericRule[] = Object.keys(
  NUMERIC_RULES
) as NumericRule[];

/** The upper bound of a lower one's pair, which it may not exceed. */
const UPPER_OF: Partial<Record<NumericRule, NumericRule>> = {
  minLength: "maxLength",
  minRows: "maxRows",
  min: "max",
};

/**
 * Why a bound as it stands cannot be kept, or `null`.
 *
 * The panel has no Apply — an edit is in the draft as soon as it is made — so
 * this is where a bad bound is caught, rather than at the collection's save:
 * a lower bound above its upper one was refused only there (core's
 * `validation.minLength must be <= validation.maxLength`), and an upper count
 * of 0 was never refused at all, quietly read downstream as "no limit" by the
 * column and the entry form alike, so a field said to hold nothing held
 * anything. A count that is not a whole number of zero or more can still be
 * typed past the input's own `min` and `step`, so it is judged here too.
 */
export function boundProblem(
  rule: NumericRule,
  values: Partial<Record<NumericRule, number>>
): string | null {
  const bound = values[rule];
  if (bound === undefined) return null;
  const { label, counts } = NUMERIC_RULES[rule];
  if (counts && (!Number.isInteger(bound) || bound < 0)) {
    return "Use a whole number, 0 or more.";
  }
  if (counts && bound === 0 && (rule === "maxLength" || rule === "maxRows")) {
    return `${label} must be at least 1.`;
  }
  const upperRule = UPPER_OF[rule];
  const upper = upperRule === undefined ? undefined : values[upperRule];
  if (upperRule !== undefined && upper !== undefined && bound > upper) {
    return `${label} can't be more than ${NUMERIC_RULES[upperRule].label.toLowerCase()}.`;
  }
  return null;
}
