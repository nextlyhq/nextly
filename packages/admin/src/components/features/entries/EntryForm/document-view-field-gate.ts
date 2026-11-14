/**
 * The values a document view's field gate reads, watched as the form watches
 * them, so a change elsewhere in the document is answered while the view is
 * up. The gate itself is `document-view-field-refusal.ts`.
 *
 * @module components/features/entries/EntryForm/document-view-field-gate
 */
import { useWatch, type Control } from "react-hook-form";

import {
  chainOf,
  conditionPathOf,
  type GatedField,
} from "./document-view-field-refusal";

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
        chainOf(field).flatMap(
          ({ step, base }) => conditionPathOf(step, base) ?? []
        )
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
