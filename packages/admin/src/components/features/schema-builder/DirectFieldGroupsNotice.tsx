/**
 * Names the field groups placed directly in a field group's own fields.
 *
 * A field group's entry is one row of its table, and a field group placed directly among its fields
 * gets no column there and no table of its own, so what is entered in it is not saved, and a save
 * that carries it is refused. Held in a group or a repeater it is stored in that container's value,
 * which is why the picker offers it only there. A definition made before that, in the builder or
 * in code, still holds the placement, and this says which fields to move.
 */
import {
  directComponentFields,
  type DirectField,
} from "nextly/field-group-type";

import { EditorAlert } from "./EditorAlert";

/** A stored field as this reads it: the walk's shape, and the label it is named by. */
type NoticeField = DirectField & { label?: unknown };

export function DirectFieldGroupsNotice({
  fields,
}: {
  /**
   * The field group's STORED fields: they keep the `virtual` flag the builder's own copy drops, and
   * a virtual field group stores nothing anywhere, so the write passes it and this must too.
   */
  fields: readonly NoticeField[];
}) {
  // The walk the write's refusal and the config's warning use, so all three name the same fields.
  const placed = (directComponentFields(fields) as NoticeField[]).map(field =>
    typeof field.label === "string" && field.label ? field.label : field.name
  );
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
