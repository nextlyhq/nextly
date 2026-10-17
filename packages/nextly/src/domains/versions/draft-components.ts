/**
 * Component values in a working draft: one shape and one merge, for every
 * kind of document that holds a draft.
 *
 * A component's values live in tables of their own, so a draft has to carry
 * them itself while the edit is held, and a publish has to write them from it.
 * Collections and Singles hold them the same way: the read shape, with each
 * component's type tagged (`tagComponentTypes`), merged sub-field by sub-field
 * when a save carries only the sub-fields it changed.
 *
 * @module domains/versions/draft-components
 */

import { isFieldGroupField } from "../../collections/fields/guards";
import type { FieldConfig } from "../../collections/fields/types";
import {
  addressableFields,
  type AddressableField,
} from "../../shared/addressable-fields";
import { extractFieldGroupReferences } from "../field-groups/storage/field-group-field-type";

import type { ComponentSchemas } from "./restore-snapshot";

/**
 * Overlay `patch` onto `base`, recursively merging single (non-repeatable)
 * component objects instead of replacing them.
 *
 * A patch-shaped save carries only the sub-fields it changed, so replacing a
 * component's whole object would drop sub-fields an earlier save set. Recurses
 * according to the resolved component schemas so a component nested inside a
 * component is merged at every depth. A dynamic zone (array), a repeatable
 * component, and a scalar are replaced whole (patch wins).
 */
export function mergeComponentPatches(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  fields: FieldConfig[],
  componentSchemas: ComponentSchemas | null
): Record<string, unknown> {
  // Flatten unnamed presentational groups (matching `tagComponentTypes`): a
  // single component declared inside such a group stores its value at the
  // enclosing level, so without flattening the lookup would miss it and treat
  // it as a scalar, replacing rather than merging a nested component patch.
  const byName = new Map<string, AddressableField>();
  for (const f of addressableFields(fields)) {
    const name = (f as { name?: unknown }).name;
    if (typeof name === "string") byName.set(name, f);
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, patchVal] of Object.entries(patch)) {
    const field = byName.get(key);
    // Through the shared extractor: a migrated definition names its fixed
    // slug under `fieldGroup`, and a merge that misses it would REPLACE the
    // whole object, dropping sibling sub-fields an earlier save set.
    const refs = field ? extractFieldGroupReferences(field) : {};
    const slug =
      field &&
      refs.single !== undefined &&
      (field as { repeatable?: unknown }).repeatable !== true
        ? refs.single
        : undefined;
    const baseVal = out[key];
    if (
      slug !== undefined &&
      isPlainObject(baseVal) &&
      isPlainObject(patchVal)
    ) {
      out[key] = mergeComponentPatches(
        baseVal,
        patchVal,
        componentSchemas?.get(slug)?.fields ?? [],
        componentSchemas
      );
    } else {
      out[key] = patchVal;
    }
  }
  return out;
}

/**
 * The component values a draft holds, keyed by field name: the top-level
 * component fields only, read straight off the draft document so a nested
 * field stays visible to the access and validation passes that see them.
 */
export function draftComponentValues(
  draft: Record<string, unknown>,
  fields: readonly FieldConfig[]
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (!isFieldGroupField(field)) continue;
    const name = (field as { name?: unknown }).name;
    // Own keys only: a field named like an Object.prototype member would
    // otherwise read an inherited function from a draft that lacks it.
    if (
      typeof name === "string" &&
      Object.prototype.hasOwnProperty.call(draft, name)
    ) {
      values[name] = draft[name];
    }
  }
  return values;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
