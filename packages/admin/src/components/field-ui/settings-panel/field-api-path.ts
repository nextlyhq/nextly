/**
 * The path by which the API returns a field, for example
 * `authors[].social[].url`: each container's name, with `[]` after a container
 * that holds a list of rows, then the field's own name.
 *
 * A field inside a group is a key of the group's object; a field inside
 * repeating rows is a key of each row, so its container reads as a list.
 */
import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { isRepeatingContainer } from "@admin/lib/builder/is-inside-repeating-ancestor";

export function fieldApiPath(
  ancestors: readonly BuilderField[],
  field: Pick<BuilderField, "name">
): string {
  return [
    ...ancestors.map(
      container =>
        `${container.name}${isRepeatingContainer(container) ? "[]" : ""}`
    ),
    field.name,
  ].join(".");
}
