/**
 * A block's visibility conditions as the "Show when" controls read and write
 * them: the operators each kind of field offers, worded as the list filter
 * words them where the two share a meaning, a condition as one sentence, and
 * a draft row as the stored condition it would be.
 *
 * The operators are exactly the engine's `CONDITION_KIND_OPS`, which the save
 * judges a condition by, so the menu never offers one the save refuses.
 *
 * @module condition-model
 */
import {
  CONDITION_KIND_OPS,
  type Condition,
  type ConditionOp,
  type ListFieldKind,
  type ListFilterOp,
} from "@nextlyhq/blocks-engine";

import { filterSentence, type QueryField } from "./list-query-model";

/** One operator an author picks, keyed for a menu. */
export interface ConditionChoice {
  readonly key: string;
  readonly op: ConditionOp;
  readonly label: string;
}

/** What each operator is called, an order worded as a number's. */
const LABELS: Readonly<Record<ConditionOp, string>> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "doesn’t contain",
  greater_than: "is more than",
  less_than: "is less than",
  exists: "has a value",
  not_exists: "is empty",
  is_true: "is",
  is_false: "is",
};

/** A date's order, worded as days, as a list's date filter is. */
const DATE_LABELS: Readonly<Partial<Record<ConditionOp, string>>> = {
  greater_than: "is after",
  less_than: "is before",
};

/**
 * The operators offered for a field of each kind, in menu order. A yes-or-no
 * field offers one, "is", whose Yes or No is stored as `is_true` or
 * `is_false`; the engine's `equals` on such a field reads the same and is
 * not offered twice.
 */
export function conditionChoices(
  kind: ListFieldKind
): readonly ConditionChoice[] {
  if (kind === "boolean") return [{ key: "is", op: "is_true", label: "is" }];
  return CONDITION_KIND_OPS[kind].map(op => ({
    key: op,
    op,
    label: (kind === "date" ? DATE_LABELS[op] : undefined) ?? LABELS[op],
  }));
}

/** The menu key a stored condition's operator is listed under. */
export function choiceKey(op: ConditionOp): string {
  return op === "is_true" || op === "is_false" ? "is" : op;
}

/** Whether an operator compares the field with a value an author gives. */
function takesValue(op: ConditionOp): boolean {
  return (
    op === "equals" ||
    op === "not_equals" ||
    op === "contains" ||
    op === "not_contains" ||
    op === "greater_than" ||
    op === "less_than"
  );
}

/**
 * The list filter operator whose value control a condition's value is chosen
 * with: the same value, compared the other way round for a negation. A
 * yes-or-no field's "is" is the filter's "is" with Yes or No.
 */
export function valueOpFor(op: ConditionOp): ListFilterOp | undefined {
  switch (op) {
    case "not_contains":
      return "contains";
    case "is_true":
    case "is_false":
      return "equals";
    case "exists":
    case "not_exists":
      return undefined;
    default:
      return op;
  }
}

/** A condition being edited: any part may be missing until it is chosen. */
export interface DraftCondition {
  readonly field?: string;
  readonly op?: ConditionOp;
  readonly value?: unknown;
}

/** The value a yes-or-no condition's Yes or No stands for. */
export function booleanValueOf(
  op: ConditionOp | undefined
): boolean | undefined {
  if (op === "is_true") return true;
  if (op === "is_false") return false;
  return undefined;
}

/** A condition as one sentence, in its three parts. */
export interface ConditionSentence {
  readonly field: string;
  readonly operator: string;
  readonly value: string;
}

/** A condition as the closed line reads it: "Reading time · is more than · 5". */
export function conditionSentence(
  draft: DraftCondition,
  field: QueryField | undefined,
  entryTitle: (id: string) => string | undefined = () => undefined
): ConditionSentence {
  const fieldWords =
    draft.field === undefined
      ? "Choose a field"
      : (field?.label ?? `${draft.field} (not offered here)`);
  if (draft.op === undefined) {
    return { field: fieldWords, operator: "", value: "" };
  }
  const operator =
    field === undefined
      ? draft.op.replaceAll("_", " ")
      : ((field.kind === "date" ? DATE_LABELS[draft.op] : undefined) ??
        LABELS[draft.op]);
  const valueOp = valueOpFor(draft.op);
  if (valueOp === undefined) return { field: fieldWords, operator, value: "" };
  const value = booleanValueOf(draft.op) ?? draft.value;
  return {
    field: fieldWords,
    operator,
    // Said as a list's filter says the same value, so one value reads one way.
    value: filterSentence(
      { field: draft.field, op: valueOp, value },
      field,
      entryTitle
    ).value,
  };
}

/** A sentence as one line of text, for a row's title and accessible name. */
export function conditionLine(sentence: ConditionSentence): string {
  return [sentence.field, sentence.operator, sentence.value]
    .filter(part => part !== "")
    .join(" ");
}

/**
 * A draft as the stored condition it would be, or why it is not one yet, in
 * words naming what to choose. Whether the value fits its field is the
 * engine's to say, as the save does, once the condition is stored.
 */
export function completedCondition(
  draft: DraftCondition,
  field: QueryField | undefined
): { readonly condition: Condition } | { readonly missing: string } {
  if (draft.field === undefined || field === undefined) {
    return { missing: "Choose a field, or remove this condition." };
  }
  if (draft.op === undefined) {
    return { missing: "Choose how to compare, or remove this condition." };
  }
  if (!takesValue(draft.op)) {
    return { condition: { field: draft.field, op: draft.op } };
  }
  if (draft.value === undefined || draft.value === "") {
    return {
      missing: `Choose a value for ${field.label}, or remove this condition.`,
    };
  }
  return {
    condition: { field: draft.field, op: draft.op, value: draft.value },
  };
}
