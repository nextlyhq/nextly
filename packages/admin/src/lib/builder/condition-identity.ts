/**
 * Whether a field's condition still reads the field it names.
 *
 * A condition names its source, and the entry form reads that name beside the
 * gated field: on its level, through containers that have no name of their
 * own. A pending change can leave it reading nothing (its source moved to
 * another level, or deleted), a field a condition cannot compare, or an option
 * a dropdown no longer has. Such a condition is broken: it stays on its field,
 * marked, and counts as an error the save refuses, until it names a field it
 * can read or is removed. Nothing is stored about it: it is judged from the
 * fields as they stand, so it holds after any change, undo or redo alike.
 *
 * @module lib/builder/condition-identity
 */
import { FIELD_TYPE_CATALOG } from "nextly/field-catalog";
import { isFieldGroupFieldType } from "nextly/field-group-type";

import type {
  BuilderField,
  FieldCondition,
} from "@admin/components/features/schema-builder/types";
import { operatorTakesValue } from "@admin/components/field-ui/ConditionRow";

import { findFieldPlacement } from "./field-placement";

/** Why a condition is broken. */
export type ConditionBreak = "no-source" | "not-a-source" | "option-removed";

/** A broken condition: why, and the sentence that tells the person. */
export interface BrokenCondition {
  reason: ConditionBreak;
  message: string;
}

/**
 * The field types a condition can compare: boolean, text-style, number, date,
 * select and radio. A relationship or media field has no scalar the evaluator
 * can compare, so a condition reading one never matches.
 */
const SOURCE_TYPES: ReadonlySet<string> = new Set([
  "checkbox",
  "text",
  "textarea",
  "richText",
  "email",
  "code",
  "password",
  // An icon id compares as text: "is set", or "equals lucide:star".
  "icon",
  "number",
  "date",
  "select",
  "radio",
]);

/** The types whose values are a fixed set of options. */
const CHOICE_TYPES: ReadonlySet<string> = new Set(["select", "radio"]);

/** Whether a field of this type can be a condition's source. */
export function isConditionSourceType(type: string): boolean {
  return SOURCE_TYPES.has(type);
}

/** The Builder's own field types, as the catalog describes them. */
const BUILT_IN_TYPES: ReadonlySet<string> = new Set(
  FIELD_TYPE_CATALOG.map(entry => entry.type)
);

/**
 * Whether a source of this type is known to hold nothing a condition can
 * compare: one of the Builder's own types outside the comparable ones, or a
 * field using a field group. A type a plugin contributes is not known here,
 * and its value may well be a plain one the entry form compares, so it is
 * never called broken for its type: a save it held up would be refused for a
 * condition that works.
 */
function cannotBeCompared(type: string): boolean {
  if (SOURCE_TYPES.has(type)) return false;
  return BUILT_IN_TYPES.has(type) || isFieldGroupFieldType(type);
}

/** A condition in one shape: the older `{ field, equals }` read as equality. */
function normalized(
  condition: FieldCondition
): Required<Pick<FieldCondition, "field" | "operator">> &
  Pick<FieldCondition, "value"> {
  if (!condition.operator && condition.equals !== undefined) {
    return {
      field: condition.field,
      operator: "equals",
      value: condition.equals,
    };
  }
  return {
    field: condition.field,
    operator: condition.operator ?? "equals",
    value: condition.value,
  };
}

/** A field's name as a sentence calls it. */
function called(field: BuilderField): string {
  return field.label || field.name || "This field";
}

/**
 * Why `field`'s condition is broken, given the fields on its level (as the
 * settings panel offers them), or null when it reads its source, or has none
 * yet: a condition not yet given a source is unfinished, not broken.
 */
export function brokenConditionOf(
  field: BuilderField,
  siblings: readonly BuilderField[]
): BrokenCondition | null {
  const stored = field.admin?.condition;
  if (!stored?.field) return null;
  const condition = normalized(stored);
  const subject = called(field);
  const source = siblings.find(each => each.name === condition.field);
  if (!source) {
    return {
      reason: "no-source",
      message: `${subject}'s condition reads ${condition.field}, which is no longer beside it. Choose another field for it, or remove the condition.`,
    };
  }
  if (cannotBeCompared(source.type)) {
    return {
      reason: "not-a-source",
      message: `${subject}'s condition reads ${called(source)}, which a condition cannot compare. Choose another field for it, or remove the condition.`,
    };
  }
  const value = condition.value;
  const optionGone =
    CHOICE_TYPES.has(source.type) &&
    operatorTakesValue(condition.operator) &&
    typeof value === "string" &&
    value !== "" &&
    !(source.options ?? []).some(option => option.value === value);
  return optionGone
    ? {
        reason: "option-removed",
        message: `${subject}'s condition compares ${called(source)} with "${value}", which is no longer one of its options. Choose another value, or remove the condition.`,
      }
    : null;
}

/**
 * Every broken condition in `fields`, by the id of the field it is on, at any
 * depth. Each is judged against the fields on its own level, the same list the
 * settings panel offers it as sources, so the panel and this check never
 * disagree about which fields a condition may read.
 */
export function brokenConditions(
  fields: readonly BuilderField[]
): Map<string, BrokenCondition> {
  const broken = new Map<string, BrokenCondition>();
  const walk = (list: readonly BuilderField[]): void => {
    for (const each of list) {
      if (each.admin?.condition) {
        const siblings = findFieldPlacement(fields, each.id)?.siblings ?? [];
        const found = brokenConditionOf(each, siblings);
        if (found) broken.set(each.id, found);
      }
      if (each.fields) walk(each.fields);
    }
  };
  walk(fields);
  return broken;
}

/**
 * `fields` once `fieldId`'s rename is followed: every condition that read the field by
 * `previousName` reads it by its new name. Called after the field has its new name, so the
 * rename and the conditions it carries are one change, and one undo.
 *
 * Only the conditions the entry form evaluates against the renamed field are followed: those on
 * the fields beside it on its level (`findFieldPlacement`), as `brokenConditionOf` judges them. A
 * condition elsewhere naming the same name reads another field, and the field's own condition is
 * not one that reads it. Returns `fields` itself when no condition follows.
 */
export function followRename(
  fields: BuilderField[],
  fieldId: string,
  previousName: string
): BuilderField[] {
  const placement = findFieldPlacement(fields, fieldId);
  if (!placement || placement.field.name === previousName) return fields;
  // Matched by identity: those very fields, whatever else in the tree shares an id with one.
  const readers = new Set(
    placement.siblings.filter(
      each => each.admin?.condition?.field === previousName
    )
  );
  if (readers.size === 0) return fields;
  const name = placement.field.name;
  const follow = (list: BuilderField[]): BuilderField[] =>
    list.map(each => {
      const condition = each.admin?.condition;
      const next =
        readers.has(each) && condition
          ? {
              ...each,
              admin: {
                ...each.admin,
                condition: { ...condition, field: name },
              },
            }
          : each;
      return next.fields ? { ...next, fields: follow(next.fields) } : next;
    });
  return follow(fields);
}
