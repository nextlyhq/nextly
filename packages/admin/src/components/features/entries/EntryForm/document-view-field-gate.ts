/**
 * Whether a document view may edit the field it opened for.
 *
 * The form draws a field read-only, disabled or not at all as its declaration
 * says, and the field's card offers no way into an editor it could not use.
 * A view's address can still be typed or shared, though, and a view handed the
 * field would edit it regardless. So the admin asks the same gates the form
 * asks — the field's own and those of the unnamed groups around it, which the
 * form applies to everything inside them — and refuses the view rather than
 * trusting each one to.
 *
 * @module components/features/entries/EntryForm/document-view-field-gate
 */
import { useWatch, type Control } from "react-hook-form";

import {
  conditionHolds,
  conditionSourcePath,
  fieldAdminGates,
} from "../fields/field-admin-gates";

/** Why a view may not edit its field, most decisive first. */
export type ViewFieldRefusal = "hidden" | "readOnly" | "disabled";

/**
 * The refusal for a field and the groups around it (outermost first), given
 * the value each condition reads. Fields a view can address sit at the top
 * level, so every condition among them reads from the document's root.
 *
 * Hidden outranks the rest: a field the form does not show at all is not one
 * the author should meet, read-only or otherwise.
 */
export function viewFieldRefusal(
  chain: readonly object[],
  valueAt: (path: string) => unknown
): ViewFieldRefusal | null {
  const gates = chain.map(fieldAdminGates);
  const hidden = gates.some(gate => {
    if (gate.hidden) return true;
    const path = conditionSourcePath(gate.condition, "");
    return path !== undefined && !conditionHolds(gate.condition, valueAt(path));
  });
  if (hidden) return "hidden";
  if (gates.some(gate => gate.readOnly)) return "readOnly";
  if (gates.some(gate => gate.disabled)) return "disabled";
  return null;
}

/** The paths the chain's conditions read, for the form to watch. */
function conditionPaths(chain: readonly object[]): string[] {
  return chain.flatMap(field => {
    const path = conditionSourcePath(fieldAdminGates(field).condition, "");
    return path === undefined ? [] : [path];
  });
}

/**
 * {@link viewFieldRefusal}, watching the values its conditions read, so a
 * change elsewhere in the document is answered as the form answers it.
 */
export function useViewFieldRefusal(
  chain: readonly object[],
  control: Control<Record<string, unknown>>
): ViewFieldRefusal | null {
  const paths = conditionPaths(chain);
  const values: unknown[] = useWatch({
    control,
    name: paths,
    disabled: paths.length === 0,
  });
  const byPath = new Map(paths.map((path, index) => [path, values?.[index]]));
  return viewFieldRefusal(chain, path => byPath.get(path));
}
