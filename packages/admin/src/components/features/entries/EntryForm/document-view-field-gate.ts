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
 * @module components/features/entries/EntryForm/document-view-field-gate
 */
import { useWatch, type Control } from "react-hook-form";

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
interface GatedField {
  declaration: object;
  within: readonly object[];
}

/** The groups around the field, outermost first, then the field. */
function chainOf(field: GatedField): readonly object[] {
  return [...field.within, field.declaration];
}

/**
 * Where a field's condition reads. Fields a view can address sit at the top
 * level, so every condition among them reads from the document's root.
 */
function conditionPathOf(field: object): string | undefined {
  return conditionSourcePath(fieldAdminGates(field).condition, "");
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
  const gate = chainOf(field).reduce<FieldGate>((inherited, step) => {
    const path = conditionPathOf(step);
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

/**
 * The values the fields' conditions read, watched as the form watches them,
 * so a change elsewhere in the document is answered while the view is up.
 */
export function useConditionValues(
  fields: readonly GatedField[],
  control: Control<Record<string, unknown>>
): (path: string) => unknown {
  const paths = [
    ...new Set(
      fields.flatMap(field =>
        chainOf(field).flatMap(step => conditionPathOf(step) ?? [])
      )
    ),
  ];
  const values: unknown[] = useWatch({
    control,
    name: paths,
    disabled: paths.length === 0,
  });
  const byPath = new Map(paths.map((path, index) => [path, values?.[index]]));
  return path => byPath.get(path);
}
