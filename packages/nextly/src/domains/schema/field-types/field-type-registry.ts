/**
 * Custom field-type registry (C7/D16, M9a minimal seam).
 *
 * Plugins contribute new field types via `contributes.fieldTypes`. Each custom
 * type maps to an existing storage primitive (so DDL/serialization reuse the
 * built-in path) and an admin component (resolved via the component registry).
 * The built-in ~19 field types keep their own switch; this registry holds ONLY
 * plugin-contributed types.
 *
 * `globalThis`-pinned + cleared per boot (clear-and-rebuild, like the route /
 * service / email-provider registries) so HMR re-registration never collides.
 *
 * @module domains/schema/field-types/field-type-registry
 */

import type { FieldSurface } from "../../../collections/fields/catalog";
import { ALL_FIELD_TYPES } from "../../../collections/fields/types";
import type { PluginFieldType } from "../../../plugins/contributions";

const BUILT_IN_TYPES = new Set<string>(ALL_FIELD_TYPES as readonly string[]);

/** The surface a plugin field type targets when its author declares none. */
const DEFAULT_FIELD_SURFACES: readonly FieldSurface[] = ["entries"];

const globalForFieldTypes = globalThis as unknown as {
  __nextly_fieldTypes?: Map<string, PluginFieldType>;
};

function store(): Map<string, PluginFieldType> {
  if (!globalForFieldTypes.__nextly_fieldTypes) {
    globalForFieldTypes.__nextly_fieldTypes = new Map();
  }
  return globalForFieldTypes.__nextly_fieldTypes;
}

/** Register a custom field type. Throws on collision with a built-in or another plugin. */
export function registerFieldType(def: PluginFieldType): void {
  if (BUILT_IN_TYPES.has(def.type)) {
    throw new Error(
      `NEXTLY_FIELD_TYPE_COLLISION: field type "${def.type}" is a built-in type and cannot be redefined.`
    );
  }
  const map = store();
  if (map.has(def.type)) {
    throw new Error(
      `NEXTLY_FIELD_TYPE_COLLISION: field type "${def.type}" is already registered by another plugin.`
    );
  }
  map.set(def.type, def);
}

/** Resolve a registered custom field type, or `undefined`. */
export function getFieldType(type: string): PluginFieldType | undefined {
  return store().get(type);
}

export function hasFieldType(type: string): boolean {
  return store().has(type);
}

/**
 * Whether a registered plugin field type may be offered/accepted on `surface`,
 * honoring its declared `surfaces` (an omitted list means the entries surface
 * only). Returns `false` for built-ins and unregistered types — every caller
 * keeps its own built-in handling and only consults this for plugin types.
 */
export function isPluginFieldTypeOnSurface(
  type: string,
  surface: FieldSurface
): boolean {
  const def = store().get(type);
  return !!def && (def.surfaces ?? DEFAULT_FIELD_SURFACES).includes(surface);
}

/** All registered custom field types (e.g. to serialize for the admin client). */
export function allFieldTypes(): PluginFieldType[] {
  return [...store().values()];
}

/** Drop all registered custom field types (per-boot reset / HMR / tests). */
export function clearFieldTypes(): void {
  store().clear();
}
