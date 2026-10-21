/**
 * Names the field groups placed directly in a field group's own fields.
 *
 * A field group's entry is one row of its table, and a field group placed directly among its fields
 * gets no column there and no table of its own, so what is entered in it is not saved, and a save
 * that carries it is refused. Held in a group or a repeater it is stored in that container's value,
 * which is why the picker offers it only there. A definition made before that, in the builder or
 * in code, still holds the placement, and this says which fields to move.
 */
import { isFieldGroupFieldType } from "nextly/field-group-type";

import { EditorAlert } from "./EditorAlert";
import type { BuilderField } from "./types";

export function DirectFieldGroupsNotice({
  fields,
}: {
  fields: readonly BuilderField[];
}) {
  const placed = fields
    .filter(field => isFieldGroupFieldType(field.type))
    .map(field => field.label || field.name);
  if (placed.length === 0) return null;
  return (
    <EditorAlert className="mb-4">
      <p>
        {placed.join(", ")} {placed.length === 1 ? "sits" : "sit"} directly in
        this field group&apos;s fields, so what is entered there is not saved,
        and a save that carries it is refused. Move{" "}
        {placed.length === 1 ? "it" : "them"} into a group or repeater.
      </p>
    </EditorAlert>
  );
}
