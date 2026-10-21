/**
 * The component fields placed DIRECTLY in a component's own fields.
 *
 * Such a field has no column on its component's row and no table write of its own, so its value
 * is not stored. The config names each one when it is defined, and the component write refuses a
 * value for one: both ask this, so the two cannot disagree about which fields are affected. One
 * held in a group or a repeater is stored in that container's JSON, and is not listed.
 *
 * The admin's schema leaves such fields out (`omitDirectComponentFields`), so its forms never draw
 * one. Kept free of anything heavier than the type predicates, because `defineConfig` reads it.
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

/**
 * `fields` without the component fields placed directly in them, keeping layout containers with
 * their other children. The schema the admin draws a component's form from is built through this,
 * so a field nothing could store is never rendered, seeded or sent.
 */
export function omitDirectComponentFields<T extends DirectField>(
  fields: readonly T[]
): T[] {
  const kept: T[] = [];
  for (const field of fields) {
    if (!field.name && field.fields) {
      kept.push({
        ...field,
        fields: omitDirectComponentFields(field.fields),
      });
      continue;
    }
    if (directComponentFields([field]).length === 0) kept.push(field);
  }
  return kept;
}
