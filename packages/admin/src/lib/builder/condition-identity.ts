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
 * fields as they stand, so it holds after any change, undo or redo alike. The
 * one exception reads the last saved definition beside them: a saved dropdown
 * whose type changes no longer has the options a condition compared it with.
 *
 * @module lib/builder/condition-identity
 */
import { FIELD_TYPE_CATALOG } from "nextly/field-catalog";
import { isFieldGroupFieldType } from "nextly/field-group-type";

import type {
  BuilderField,
  FieldCondition,
} from "@admin/components/features/schema-builder/types";
import {
  operatorTakesValue,
  operatorsForType,
} from "@admin/components/field-ui/ConditionRow";

import {
  findFieldPlacement,
  findFieldPlacements,
  type FieldPlacement,
} from "./field-placement";

/** Why a condition is broken. */
export type ConditionBreak =
  | "no-source"
  | "not-a-source"
  | "operator-unsupported"
  | "option-removed";

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
 * Comparisons the entry form evaluates the same on a value of any type: equality, which every type
 * supports (an older `{ field, equals }` condition on a checkbox among them), and a value's presence.
 */
const ANY_TYPE_OPERATORS: ReadonlySet<string> = new Set([
  "equals",
  "notEquals",
  "isEmpty",
  "isNotEmpty",
]);

/**
 * Whether a source of `type` can be compared by `operator`: one the condition row offers for that
 * type, or one that reads a value of any type (`ANY_TYPE_OPERATORS`). A type a plugin contributes is
 * not known here, so its operators are never judged: as with a source's type, a save it held up
 * would be refused for a condition that works.
 */
function operatorFits(type: string, operator: string): boolean {
  if (!BUILT_IN_TYPES.has(type) || ANY_TYPE_OPERATORS.has(operator)) {
    return true;
  }
  return (operatorsForType(type) as readonly string[]).includes(operator);
}

/**
 * Why `field`'s condition is broken, given the fields on its level (as the
 * settings panel offers them), or null when it reads its source, or has none
 * yet: a condition not yet given a source is unfinished, not broken. `saved` is
 * where the field was last saved (`savedPlaceOf`), where there is one: a source
 * that was saved as a dropdown and is now another type no longer has the
 * options a condition inherited from it compares with. A comparison made since,
 * or changed since, reads the source as it is now.
 */
export function brokenConditionOf(
  field: BuilderField,
  siblings: readonly BuilderField[],
  saved?: FieldPlacement
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
  if (!operatorFits(source.type, condition.operator)) {
    return {
      reason: "operator-unsupported",
      message: `${subject}'s condition compares ${called(source)} in a way a ${source.type} field cannot. Choose another comparison, or remove the condition.`,
    };
  }
  return (
    formerOptionBreak(subject, source, condition, saved) ??
    missingOptionBreak(subject, source, condition)
  );
}

/** The text a condition compares its source with, where its comparison takes one; else null. */
function comparedText(condition: ReturnType<typeof normalized>): string | null {
  return operatorTakesValue(condition.operator) &&
    typeof condition.value === "string"
    ? condition.value
    : null;
}

/**
 * A condition inherited from a saved dropdown that is now another type, comparing it with one of the
 * options it had (`saved`, where the reader was last saved).
 */
function formerOptionBreak(
  subject: string,
  source: BuilderField,
  condition: ReturnType<typeof normalized>,
  saved: FieldPlacement | undefined
): BrokenCondition | null {
  const value = comparedText(condition);
  const wasChoice = saved?.siblings.find(each => each.id === source.id);
  if (value === null || wasChoice === undefined) return null;
  const former =
    CHOICE_TYPES.has(wasChoice.type) &&
    !CHOICE_TYPES.has(source.type) &&
    comparedBeforeTheChange(saved?.field, wasChoice, condition) &&
    (wasChoice.options ?? []).some(option => option.value === value);
  return former
    ? {
        reason: "option-removed",
        message: `${subject}'s condition compares ${called(source)} with "${value}", one of the options it had as a dropdown, which it no longer has. Choose another value, or remove the condition.`,
      }
    : null;
}

/** A condition comparing a choice with a value that is not one of its options. */
function missingOptionBreak(
  subject: string,
  source: BuilderField,
  condition: ReturnType<typeof normalized>
): BrokenCondition | null {
  const value = comparedText(condition);
  const gone =
    value !== null &&
    value !== "" &&
    CHOICE_TYPES.has(source.type) &&
    !(source.options ?? []).some(option => option.value === value);
  return gone
    ? {
        reason: "option-removed",
        message: `${subject}'s condition compares ${called(source)} with "${value}", which is no longer one of its options. Choose another value, or remove the condition.`,
      }
    : null;
}

/**
 * Whether the saved field `reader` compared the saved source `wasSource` just as `condition` does
 * now: read of it, by the same operator, with the same value. Its name in the saved definition is
 * what the saved condition read it by.
 */
function comparedBeforeTheChange(
  reader: BuilderField | undefined,
  wasSource: BuilderField,
  condition: ReturnType<typeof normalized>
): boolean {
  const stored = reader?.admin?.condition;
  if (!stored?.field) return false;
  const was = normalized(stored);
  return (
    was.field === wasSource.name &&
    was.operator === condition.operator &&
    was.value === condition.value
  );
}

/**
 * Where the field `fieldId` was last saved, told from its namesakes by the containers above it as
 * they are now (`ancestors`): an id can repeat across containers. Only where nothing else was saved
 * under that id is the single place it was saved taken, wherever it stands now; none otherwise.
 */
export function savedPlaceOf(
  saved: readonly BuilderField[],
  fieldId: string,
  ancestors: readonly BuilderField[]
): FieldPlacement | undefined {
  const places = findFieldPlacements(saved, fieldId);
  const here = places.find(
    place =>
      place.ancestors.length === ancestors.length &&
      place.ancestors.every((each, at) => each.id === ancestors[at].id)
  );
  return here ?? (places.length === 1 ? places[0] : undefined);
}

/**
 * Every broken condition in `fields`, by the id of the field it is on, at any
 * depth. Each is judged against the fields on its own level, the same list the
 * settings panel offers it as sources, so the panel and this check never
 * disagree about which fields a condition may read. `saved` is the last saved
 * definition's fields, where there is one (`brokenConditionOf`).
 */
export function brokenConditions(
  fields: readonly BuilderField[],
  saved: readonly BuilderField[] = []
): Map<string, BrokenCondition> {
  const broken = new Map<string, BrokenCondition>();
  const walk = (list: readonly BuilderField[]): void => {
    for (const each of list) {
      if (each.admin?.condition) {
        const placement = findFieldPlacement(fields, each.id);
        const found = brokenConditionOf(
          each,
          placement?.siblings ?? [],
          savedPlaceOf(saved, each.id, placement?.ancestors ?? [])
        );
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
 * not one that reads it. A rename from or to an empty name follows nothing. Returns `fields`
 * itself when no condition follows.
 */
export function followRename(
  fields: BuilderField[],
  fieldId: string,
  previousName: string
): BuilderField[] {
  const placement = findFieldPlacement(fields, fieldId);
  // A condition not yet given a source reads "" too, so a name cleared to be typed again carries
  // nothing: from or to an empty name, no condition is this field's to follow.
  if (
    !placement ||
    !previousName ||
    !placement.field.name ||
    placement.field.name === previousName
  ) {
    return fields;
  }
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
