/**
 * The component fields placed DIRECTLY in a component's own fields.
 *
 * Such a field's instances are rows of their own table, whose parent is the outer component's
 * row; one held in a group or a repeater is stored in that container's JSON, and is not listed.
 * Published through `nextly/field-group-type`, and kept free of anything heavier than the type
 * predicates so a browser bundle can import it.
 *
 * @module domains/field-groups/direct-component-fields
 */

import { isVirtualField } from "../../collections/fields/virtual";

import { isFieldGroupFieldType } from "./storage/field-group-field-type";

/** The field shape this walk reads. */
export type DirectField = {
  name?: string;
  type?: unknown;
  virtual?: unknown;
  options?: unknown;
  fields?: readonly DirectField[];
};

/**
 * Each component field among `fields`, at their top level or inside a layout container (a row,
 * tabs, a collapsible), which keeps its children on the same instance. A virtual one stores
 * nothing anywhere, so it is not listed.
 */
export function directComponentFields(
  fields: readonly DirectField[]
): DirectField[] {
  const found: DirectField[] = [];
  for (const field of fields) {
    if (!field.name) {
      if (field.fields) found.push(...directComponentFields(field.fields));
      continue;
    }
    if (isFieldGroupFieldType(field.type) && !isVirtualField(field)) {
      found.push(field);
    }
  }
  return found;
}
