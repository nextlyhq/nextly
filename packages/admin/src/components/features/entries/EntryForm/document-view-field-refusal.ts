/**
 * Whether a document view may edit a field, by the form's own decision.
 *
 * The form draws a field read-only, disabled or not at all as its declaration
 * says, and the field's card offers no way into an editor it could not use.
 * A view's address can still be typed or shared, though, and a view handed the
 * field would edit it regardless. So the admin asks the form's own decision —
 * `effectiveFieldGate`, folded over the unnamed groups around the field and
 * then the field, as the form passes it down when it draws them — and refuses
 * the view rather than trusting each one to.
 *
 * Apart from the hook that watches the values it reads
 * (`document-view-field-gate.ts`): the admin's first load calls this decision,
 * and importing it from the hook's module would bring the form library into
 * that load with it.
 *
 * @module components/features/entries/EntryForm/document-view-field-refusal
 */
import {
  conditionSourcePath,
  effectiveFieldGate,
  fieldAdminGates,
  OPEN_GATE,
  type FieldGate,
} from "../fields/field-admin-gates";

/** Why a view may not edit its field, most decisive first. */
export type ViewFieldRefusal = "hidden" | "readOnly" | "disabled";

/** A field a view could edit, with the unnamed groups around it. */
export interface GatedField {
  declaration: object;
  within: readonly object[];
  /**
   * The base path each of `within` and then the field sits under, where a
   * condition on that step reads its value. Absent, every step is read at the
   * top level, which is where a field outside named groups sits.
   */
  bases?: readonly string[];
}

/**
 * The groups around the field, outermost first, then the field, each with the
 * base path it sits under.
 */
export function chainOf(field: GatedField): { step: object; base: string }[] {
  return [...field.within, field.declaration].map((step, index) => ({
    step,
    base: field.bases?.[index] ?? "",
  }));
}

/**
 * Where a step's condition reads: the field it names, beside the step, under
 * the step's own base path. A field inside a `hero` group reads `hero.<name>`.
 */
export function conditionPathOf(
  field: object,
  base: string
): string | undefined {
  return conditionSourcePath(fieldAdminGates(field).condition, base);
}

/**
 * The form's decision about a field, given the value each condition reads.
 * Hidden outranks the rest: a field the form does not draw at all is not one
 * the author should meet, read-only or otherwise.
 */
export function viewFieldRefusal(
  field: GatedField,
  valueAt: (path: string) => unknown
): ViewFieldRefusal | null {
  const gate = chainOf(field).reduce<FieldGate>((inherited, { step, base }) => {
    const path = conditionPathOf(step, base);
    return effectiveFieldGate(
      step,
      inherited,
      path === undefined ? undefined : valueAt(path)
    );
  }, OPEN_GATE);
  if (!gate.shown) return "hidden";
  if (gate.readOnly) return "readOnly";
  if (gate.disabled) return "disabled";
  return null;
}
