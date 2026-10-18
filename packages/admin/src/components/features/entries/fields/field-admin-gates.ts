/**
 * A field's own edit gates, as its declaration states them: read-only,
 * disabled, hidden, and the condition that decides whether it is shown.
 *
 * One reading for every surface that edits a field. The form applies them as
 * it draws the field, and a document view that edits one field on a screen of
 * its own has to refuse exactly what the form refuses — a second reading of
 * the declaration would agree today and drift the day either learned a gate.
 *
 * @module components/features/entries/fields/field-admin-gates
 */
import type { FieldCondition } from "@admin/components/features/schema-builder/types";
import { evaluateCondition } from "@admin/lib/builder/condition-evaluator";

export interface FieldAdminGates {
  readOnly: boolean;
  disabled: boolean;
  /** Never drawn in the form, whatever its condition. */
  hidden: boolean;
  /** Shown only while this holds; absent, always shown. */
  condition: FieldCondition | undefined;
}

/** The declaration's `admin` options, when it has any. */
function adminOptionsOf(field: object): Record<string, unknown> | undefined {
  if (!("admin" in field)) return undefined;
  const admin: unknown = field.admin;
  return typeof admin === "object" && admin !== null
    ? (admin as Record<string, unknown>)
    : undefined;
}

/** A condition worth evaluating: one that names the field it reads. */
function conditionOf(value: unknown): FieldCondition | undefined {
  return typeof value === "object" &&
    value !== null &&
    "field" in value &&
    typeof value.field === "string" &&
    value.field !== ""
    ? (value as FieldCondition)
    : undefined;
}

export function fieldAdminGates(field: object): FieldAdminGates {
  const admin = adminOptionsOf(field);
  return {
    // Truthiness, as the form has always read them: a declaration from the
    // Schema Builder is stored JSON, and refusing a value the form accepts
    // would open a field here that the form keeps shut.
    readOnly: Boolean(admin?.readOnly),
    disabled: Boolean(admin?.disabled),
    hidden: Boolean(admin?.hidden),
    condition: conditionOf(admin?.condition),
  };
}

/**
 * Where a condition reads its value: the field it names, beside the gated
 * field under the same base path.
 */
export function conditionSourcePath(
  condition: FieldCondition | undefined,
  basePath: string
): string | undefined {
  if (condition === undefined) return undefined;
  return basePath ? `${basePath}.${condition.field}` : condition.field;
}

/** Whether a field with this condition is shown, given its source's value. */
function conditionHolds(
  condition: FieldCondition | undefined,
  sourceValue: unknown
): boolean {
  return evaluateCondition(condition, sourceValue);
}

/**
 * What the form decides about a field: whether it is drawn at all, and how far
 * it may be edited. A parent passes its own down — a hidden group draws none
 * of its fields, and a read-only one makes them all read-only — so a field's
 * answer starts from what it inherits.
 */
export interface FieldGate {
  shown: boolean;
  readOnly: boolean;
  disabled: boolean;
}

/** What a top-level field inherits: nothing that closes it. */
export const OPEN_GATE: FieldGate = {
  shown: true,
  readOnly: false,
  disabled: false,
};

/**
 * The form's one decision about a field, from what it inherits, its own gates
 * and the value its condition reads. The form takes it one field at a time as
 * it draws; a surface editing a field on its own folds it over the unnamed
 * groups around the field and then the field. Either way it is this function,
 * so the two cannot disagree about a field.
 */
export function effectiveFieldGate(
  field: object,
  inherited: FieldGate,
  conditionValue: unknown
): FieldGate {
  const own = fieldAdminGates(field);
  const conditionMet =
    own.condition === undefined ||
    conditionHolds(own.condition, conditionValue);
  return {
    shown: inherited.shown && !own.hidden && conditionMet,
    readOnly: inherited.readOnly || own.readOnly,
    disabled: inherited.disabled || own.disabled,
  };
}
