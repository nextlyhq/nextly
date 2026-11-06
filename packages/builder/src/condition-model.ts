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
  conditionFieldKind,
  type Condition,
  type ConditionFieldKind,
  type ConditionOp,
  type ListFilterOp,
} from "@nextlyhq/blocks-engine";

import type { LoopCollection, LoopListField } from "./content-controls";
import { filterSentence, type QueryField } from "./list-query-model";

/**
 * A field a condition can check: one a list filters by, with its kind, or a
 * field the public may read that no list filters by (several entries, media,
 * rich text, a time of day), which a condition can only ask has a value.
 */
export interface ConditionField {
  readonly name: string;
  readonly label: string;
  readonly kind: ConditionFieldKind;
  readonly options?: QueryField["options"];
  readonly relationTo?: string;
  readonly dateOnly?: boolean;
  /** What the field menu calls a field of kind `other`: "Several entries". */
  readonly kindWords?: string;
}

/** One readable field, as a collection sends it. */
type ReadableField = NonNullable<LoopCollection["readable"]>[number];

/** What the field menu calls a field no list filters by, by what it holds. */
function otherKindWords(shape: ReadableField): string {
  // Before relations: an upload names the collection its files are in too.
  if (shape.type === "upload") {
    return shape.hasMany === true ? "Several files" : "Media";
  }
  if (shape.relationTo !== undefined) {
    return shape.hasMany === true ? "Several entries" : "Entry";
  }
  if (shape.timeOnly === true) return "Time of day";
  if (shape.type === "richText") return "Rich text";
  if (shape.hasMany === true) return "Several values";
  return "Other";
}

/**
 * The fields a block's conditions can check in a collection: its list
 * fields, then every other field the public may read, as the engine's kind
 * for it says (`other`), in the collection's order. Derived from the readable
 * schema the save judges by, so the editor offers what the save accepts.
 */
export function conditionFieldsOf(
  collection: LoopCollection
): readonly ConditionField[] {
  const listed = new Set(collection.fields.map(field => field.name));
  const others = (collection.readable ?? []).flatMap(
    (shape): ConditionField[] => {
      if (listed.has(shape.name)) return [];
      // Of the kind the save judges it by: a field no list offers may still
      // be a scalar, such as an entry's id, with that kind's operators.
      const kind = conditionFieldKind(shape);
      return [
        {
          name: shape.name,
          label: shape.label ?? shape.name,
          kind,
          ...(kind === "other" ? { kindWords: otherKindWords(shape) } : {}),
          ...(kind === "entry" && typeof shape.relationTo === "string"
            ? { relationTo: shape.relationTo }
            : {}),
        },
      ];
    }
  );
  return [...collection.fields, ...others];
}

/** A field as a list's filter controls take it, for one a list filters by. */
export function asListField(
  field: ConditionField | undefined
): LoopListField | undefined {
  if (field === undefined || field.kind === "other") return undefined;
  return { ...field, kind: field.kind };
}

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
 * A yes-or-no field's `equals` and `not_equals` against No, worded apart from
 * "is": unlike `is_false`, `equals` No doesn't hold for a field with no value,
 * and `not_equals` No holds for one.
 */
const BOOLEAN_EXACT: Readonly<Partial<Record<ConditionOp, string>>> = {
  equals: "is set to",
  not_equals: "isn’t set to",
};

/**
 * The operators offered for a field of each kind, in menu order. A yes-or-no
 * field offers one, "is", whose Yes or No is stored as `is_true` or
 * `is_false`. The engine's `equals` and `not_equals` against Yes read as
 * those (see `toDraft`); against No they differ on an empty value, so a
 * stored one is listed as it is, `current`, and is otherwise not offered.
 */
export function conditionChoices(
  kind: ConditionFieldKind,
  current?: ConditionOp
): readonly ConditionChoice[] {
  if (kind === "boolean") {
    const exact = current === undefined ? undefined : BOOLEAN_EXACT[current];
    return [
      { key: "is", op: "is_true", label: "is" },
      ...(exact === undefined || current === undefined
        ? []
        : [{ key: current, op: current, label: exact }]),
    ];
  }
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

/** What an operator is called for a field of a kind. */
function operatorWords(op: ConditionOp, kind: ConditionFieldKind): string {
  const special =
    kind === "date"
      ? DATE_LABELS[op]
      : kind === "boolean"
        ? BOOLEAN_EXACT[op]
        : undefined;
  return special ?? LABELS[op];
}

/** A condition as the closed line reads it: "Reading time · is more than · 5". */
export function conditionSentence(
  draft: DraftCondition,
  field: ConditionField | undefined,
  entryTitle: (id: string) => string | undefined = () => undefined
): ConditionSentence {
  const fieldWords =
    draft.field === undefined
      ? "Choose a field"
      : (field?.label ?? `${draft.field} (not offered here)`);
  if (draft.op === undefined) {
    return { field: fieldWords, operator: "", value: "" };
  }
  // A field this collection doesn't offer still has its operator said in
  // words, as one it does: "has a value", not the stored "exists".
  const operator =
    field === undefined
      ? LABELS[draft.op]
      : operatorWords(draft.op, field.kind);
  const valueOp = valueOpFor(draft.op);
  if (valueOp === undefined) return { field: fieldWords, operator, value: "" };
  const value = booleanValueOf(draft.op) ?? draft.value;
  return {
    field: fieldWords,
    operator,
    // Said as a list's filter says the same value, so one value reads one way.
    value: filterSentence(
      { field: draft.field, op: valueOp, value },
      asListField(field),
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
  field: Pick<ConditionField, "label" | "kind"> | undefined
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
  // Empty text is a value text equality compares with, as the save reads
  // it; every other comparison needs something to compare.
  const emptyAllowed =
    field.kind === "text" &&
    (draft.op === "equals" || draft.op === "not_equals");
  if (draft.value === undefined || (draft.value === "" && !emptyAllowed)) {
    return {
      missing: `Choose a value for ${field.label}, or remove this condition.`,
    };
  }
  // A number too large to hold, read as Infinity, is one the save refuses,
  // so it is never written.
  if (typeof draft.value === "number" && !Number.isFinite(draft.value)) {
    return {
      missing: `Enter a smaller number for ${field.label}, or remove this condition.`,
    };
  }
  return {
    condition: { field: draft.field, op: draft.op, value: draft.value },
  };
}
