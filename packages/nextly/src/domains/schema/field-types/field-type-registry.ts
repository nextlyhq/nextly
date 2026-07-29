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

import { AsyncLocalStorage } from "node:async_hooks";

import type { FieldSurface } from "../../../collections/fields/catalog";
import { DEFAULT_FIELD_SURFACES } from "../../../collections/fields/catalog";
import { ALL_FIELD_TYPES } from "../../../collections/fields/types";
import type { PluginFieldType } from "../../../plugins/contributions";

const BUILT_IN_TYPES = new Set<string>(ALL_FIELD_TYPES as readonly string[]);

const globalForFieldTypes = globalThis as unknown as {
  __nextly_fieldTypes?: Map<string, PluginFieldType>;
};

/**
 * The registry an operation reads, when it declared one of its own.
 *
 * The live set below belongs to whichever config was loaded last. That is right
 * for serving requests and wrong for work that is already underway against an
 * earlier config: `db:sync --watch` reloads on save, and a reload clears and
 * rebuilds the live set while the previous sync may still be materializing
 * columns. Resolution runs deep inside the schema pipeline — `classifyFieldKind`
 * calls this from beneath `getColumnDescriptor` — so an operation pins its
 * registry for the length of its async run instead of threading one through
 * every frame in between.
 */
const scopedFieldTypes = new AsyncLocalStorage<
  ReadonlyMap<string, PluginFieldType>
>();

/** The live set, which registration and clearing always act on. */
function liveStore(): Map<string, PluginFieldType> {
  if (!globalForFieldTypes.__nextly_fieldTypes) {
    globalForFieldTypes.__nextly_fieldTypes = new Map();
  }
  return globalForFieldTypes.__nextly_fieldTypes;
}

/** What a lookup resolves against: the operation's own set, else the live one. */
function store(): ReadonlyMap<string, PluginFieldType> {
  return scopedFieldTypes.getStore() ?? liveStore();
}

/**
 * Run `operation` with `fieldTypes` as the registry every lookup inside it sees.
 *
 * Scoped rather than installed, so a reload replacing the live set midway
 * through changes nothing for work already running, and the operation cannot
 * leave a stale set behind for anyone else.
 */
export function runWithFieldTypes<T>(
  fieldTypes: ReadonlyMap<string, PluginFieldType> | undefined,
  operation: () => T
): T {
  if (!fieldTypes) return operation();
  return scopedFieldTypes.run(fieldTypes, operation);
}

/** Register a custom field type. Throws on collision with a built-in or another plugin. */
export function registerFieldType(def: PluginFieldType): void {
  if (BUILT_IN_TYPES.has(def.type)) {
    throw new Error(
      `NEXTLY_FIELD_TYPE_COLLISION: field type "${def.type}" is a built-in type and cannot be redefined.`
    );
  }
  const map = liveStore();
  if (map.has(def.type)) {
    throw new Error(
      `NEXTLY_FIELD_TYPE_COLLISION: field type "${def.type}" is already registered by another plugin.`
    );
  }
  map.set(def.type, def);
}

/**
 * The registrable form of a field type contributed by `plugin`.
 *
 * A disabled plugin keeps its declarative schema — storage primitive, admin
 * component, picker metadata — because its collections are retained and their
 * fields still have to resolve and render. Its callbacks are not declarative:
 * they are the plugin's code, running on every write (`validate`) and on every
 * schema load (`validateOptions`). Dropping them here rather than guarding at
 * each call site keeps "disabled means no behavior" a property of what is in
 * the registry.
 *
 * Dropping `validateOptions` matters most of all: a disabled plugin's fields
 * are still read back and revalidated, so a check left running could refuse the
 * very schema it is retained to keep working.
 */
export function withoutDisabledBehavior(
  fieldType: PluginFieldType,
  plugin: { enabled?: boolean }
): PluginFieldType {
  if (plugin.enabled !== false) return fieldType;
  const declarative = { ...fieldType };
  delete declarative.validate;
  delete declarative.validateOptions;
  return declarative;
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
  liveStore().clear();
}

/**
 * Capture the registered types so a failed rebuild can put them back.
 *
 * Loading a config clears this registry before re-registering from the new
 * plugin list. A load that fails partway leaves it empty while the process
 * keeps serving the previous config, and an unregistered type falls back to a
 * built-in storage primitive — so the schema derived for those fields would be
 * wrong until the next successful load.
 */
export function snapshotFieldTypes(): ReadonlyMap<string, PluginFieldType> {
  return new Map(liveStore());
}

/**
 * Reinstate a captured set, replacing whatever is registered now.
 *
 * Writes to the map directly rather than through `registerFieldType`, whose
 * collision guard exists to catch two plugins claiming one name; these entries
 * were already accepted by it once.
 */
export function restoreFieldTypes(
  snapshot: ReadonlyMap<string, PluginFieldType>
): void {
  const map = liveStore();
  map.clear();
  for (const [type, definition] of snapshot) {
    map.set(type, definition);
  }
}
