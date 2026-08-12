/**
 * Recording which component a snapshot's values came from.
 *
 * A field naming ONE component stores no type on its rows: the schema implies
 * it, so an ordinary read omits it and the column stays null. A version
 * snapshot cannot rely on that implication, because the field may name a
 * different component by the time the snapshot is restored — and with no type
 * recorded, the old component's values get pruned against the new component's
 * schema and written into it wherever a field name overlaps.
 *
 * Applied to the snapshot alone, never to the read it came from. The component
 * values a write reads back are also what the outbox event carries, and that
 * payload is documented as read shape — adding an internal marker to it would
 * put a key in every webhook that no ordinary read produces.
 *
 * @module domains/versions/tag-component-types
 */

import type { FieldConfig } from "../../collections/fields/types";
import { storageTypeToken } from "../../shared/lib/plugin-storage";
import {
  clearFieldGroupType,
  currentFieldGroupTypeKey,
  readFieldGroupType,
} from "../field-groups/storage/field-group-type-key";

import type { ComponentSchemas } from "./restore-snapshot";

/**
 * Looks up a component's own fields by slug.
 *
 * Supplied by the capture site, which holds the component data service. Without
 * it the walk stops at the entity's schema and a component embedded in another
 * component goes untagged.
 */
export type ComponentFieldResolver = (
  slug: string
) => FieldConfig[] | undefined;

/**
 * Fields addressable at this level, with presentational groups flattened.
 *
 * A group with no name exists to lay fields out: its children are stored at the
 * level the group sits in, not under it. Skipping the group without descending
 * would leave a component inside a layout group untagged, and that grouping is
 * common enough to be the usual case rather than an edge one.
 */
export function addressableFields(fields: FieldConfig[]): FieldConfig[] {
  const flat: FieldConfig[] = [];

  for (const field of fields) {
    const named = typeof field.name === "string" && field.name.length > 0;
    if (named) {
      flat.push(field);
      continue;
    }

    // Presentational groups nest, so one inside another still resolves.
    const children = (field as { fields?: unknown }).fields;
    if (Array.isArray(children)) {
      flat.push(...addressableFields(children as FieldConfig[]));
    }
  }

  return flat;
}

/** The component slug a field names, when it names exactly one. */
function singleComponentSlug(field: FieldConfig): string | undefined {
  // Only the single-component shape. A dynamic zone declares `components` and
  // already stores a type per row, chosen by the editor rather than implied.
  const slug = (field as { component?: unknown }).component;
  return typeof slug === "string" ? slug : undefined;
}

/** The component slugs a dynamic zone allows, when the field is one. */
function dynamicZoneSlugs(field: FieldConfig): string[] | undefined {
  const many = (field as { components?: unknown }).components;
  if (!Array.isArray(many)) return undefined;
  return many.filter((slug): slug is string => typeof slug === "string");
}

/**
 * Tag every component value reachable from `fields` within one object.
 *
 * The single walk all three entry points share. A field naming one component,
 * a dynamic zone, and a plain container each reach nested components by a
 * different route, and splitting them into separate walks is how a component
 * ends up tagged in one shape and untagged in another.
 *
 * `seen` holds the values on the current path, so a value that somehow refers
 * back to itself terminates. It is scoped to the path rather than the whole
 * walk: the same object appearing twice as siblings is ordinary repeated data,
 * and both copies still get tagged.
 */
function tagFieldsIn(
  source: Record<string, unknown>,
  fields: FieldConfig[],
  resolve: ComponentFieldResolver | undefined,
  seen: Set<object>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...source };

  for (const field of addressableFields(fields)) {
    if (typeof field.name !== "string") continue;
    if (!Object.prototype.hasOwnProperty.call(source, field.name)) continue;

    const value = source[field.name];

    const slug = singleComponentSlug(field);
    if (slug !== undefined) {
      out[field.name] = tagValue(value, slug, resolve, seen);
      continue;
    }

    const zone = dynamicZoneSlugs(field);
    if (zone !== undefined) {
      out[field.name] = tagZoneRows(value, zone, resolve, seen);
      continue;
    }

    // Containers nest, so a component two levels down is still reachable.
    const children = (field as { fields?: unknown }).fields;
    if (Array.isArray(children)) {
      out[field.name] = tagNestedComponentTypes(
        value,
        children as FieldConfig[],
        resolve,
        seen
      );
    }
  }

  return out;
}

/**
 * Stamp one value, or each element when the field is repeatable.
 *
 * Descends into the component's OWN fields when they can be resolved, so a
 * component embedded in another component is tagged too. Its values live in the
 * outer component's deserialized object, so the same walk reaches them.
 */
function tagValue(
  value: unknown,
  slug: string,
  resolve?: ComponentFieldResolver,
  seen: Set<object> = new Set()
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => tagValue(item, slug, resolve, seen));
  }
  if (typeof value !== "object" || value === null) return value;

  const source = value as Record<string, unknown>;
  if (seen.has(source)) return source;

  // Guarded on the value rather than the slug. A schema that refers to itself
  // — `node` holding a `node` — describes finite data of any depth, and
  // stopping at the repeated slug would tag the first two levels and leave
  // every level below them bare.
  const ownFields = resolve?.(slug);
  if (!ownFields) return { ...source, [currentFieldGroupTypeKey]: slug };

  seen.add(source);
  const inner = tagFieldsIn(source, ownFields, resolve, seen);
  seen.delete(source);

  return { ...inner, [currentFieldGroupTypeKey]: slug };
}

/**
 * Descend into a dynamic zone's rows using each row's own component schema.
 *
 * A zone row already records the component the editor chose, so nothing is
 * stamped here — only the components nested inside the row are tagged. Without
 * this, a single component sitting inside a zone row keeps no record of its
 * type and a later restore prunes it against whichever component the field
 * names by then.
 */
function tagZoneRows(
  value: unknown,
  allowed: string[],
  resolve: ComponentFieldResolver | undefined,
  seen: Set<object>
): unknown {
  if (Array.isArray(value)) {
    return value.map(row => tagZoneRows(row, allowed, resolve, seen));
  }
  if (typeof value !== "object" || value === null) return value;

  const source = value as Record<string, unknown>;
  if (seen.has(source)) return source;

  // The row's own type decides which schema its values belong to. A row whose
  // type is missing, or names a component the field does not allow, is left
  // alone rather than walked against a schema that may not describe it.
  const rowType = readFieldGroupType(source);
  if (rowType === undefined || !allowed.includes(rowType)) return source;

  const ownFields = resolve?.(rowType);
  if (!ownFields) return source;

  seen.add(source);
  const out = tagFieldsIn(source, ownFields, resolve, seen);
  seen.delete(source);

  return out;
}

/**
 * A copy of `components` with each single-component value carrying the slug its
 * field named.
 *
 * Returns a new object; the input is what the caller hands to the outbox and
 * must not gain the marker.
 */
export function tagComponentTypes(
  components: Record<string, unknown>,
  fields: FieldConfig[],
  resolve?: ComponentFieldResolver
): Record<string, unknown> {
  // Own properties only, checked inside the shared walk. `in` also matches
  // inherited ones, so a field named `constructor` or `__proto__` would be
  // treated as captured and tagged when nothing of the sort was read back.
  return tagFieldsIn(components, fields, resolve, new Set());
}

/**
 * Tag single-component values nested inside a container's stored JSON.
 *
 * A group or repeater is one column, so a component field declared inside one
 * never appears as a key of `components` — its value rides along in the
 * container's value on the parent row. The schema still says which component it
 * names, so the same tagging applies; it just has to be reached through the
 * container.
 *
 * Returns a new value. The row this reads from is also what the outbox event
 * carries.
 */
export function tagNestedComponentTypes(
  value: unknown,
  fields: FieldConfig[],
  resolve?: ComponentFieldResolver,
  seen: Set<object> = new Set()
): unknown {
  if (Array.isArray(value)) {
    return value.map(row =>
      tagNestedComponentTypes(row, fields, resolve, seen)
    );
  }
  if (typeof value !== "object" || value === null) return value;

  return tagFieldsIn(value as Record<string, unknown>, fields, resolve, seen);
}

/**
 * Remove the single-component `_componentType` markers a snapshot carries from a
 * document about to be served as an ordinary read — a mutation response or a
 * hook argument assembled from a working-draft snapshot.
 *
 * `tagComponentTypes` stamps a single-component value with its slug so a restore
 * can resolve the component even if the field is later retargeted, but an
 * ordinary read of a single component omits it (the schema implies the type). A
 * dynamic zone's row type is editor-chosen and part of read shape, so it is
 * kept; only the components nested inside a row are cleaned. The inverse of the
 * tag walk, sharing its field classification.
 *
 * Returns a new object; the tagged snapshot the input came from is untouched, so
 * the persisted copy keeps the markers a promote needs.
 */
export function stripSingleComponentTags(
  document: Record<string, unknown>,
  fields: FieldConfig[],
  resolve?: ComponentFieldResolver
): Record<string, unknown> {
  return stripFieldsIn(document, fields, resolve, new Set());
}

function stripFieldsIn(
  source: Record<string, unknown>,
  fields: FieldConfig[],
  resolve: ComponentFieldResolver | undefined,
  seen: Set<object>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...source };

  for (const field of addressableFields(fields)) {
    if (typeof field.name !== "string") continue;
    if (!Object.prototype.hasOwnProperty.call(source, field.name)) continue;

    const value = source[field.name];

    const slug = singleComponentSlug(field);
    if (slug !== undefined) {
      out[field.name] = stripSingleValue(value, slug, resolve, seen);
      continue;
    }

    const zone = dynamicZoneSlugs(field);
    if (zone !== undefined) {
      out[field.name] = stripZoneRows(value, zone, resolve, seen);
      continue;
    }

    const children = (field as { fields?: unknown }).fields;
    if (Array.isArray(children)) {
      out[field.name] = stripNestedTags(
        value,
        children as FieldConfig[],
        resolve,
        seen
      );
    }
  }

  return out;
}

/** Strip the marker off a single-component value, descending into its own fields. */
function stripSingleValue(
  value: unknown,
  slug: string,
  resolve: ComponentFieldResolver | undefined,
  seen: Set<object>
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => stripSingleValue(item, slug, resolve, seen));
  }
  if (typeof value !== "object" || value === null) return value;

  const source = value as Record<string, unknown>;
  if (seen.has(source)) return source;

  const ownFields = resolve?.(slug);
  if (!ownFields) {
    const bare = { ...source };
    clearFieldGroupType(bare);
    return bare;
  }

  seen.add(source);
  const inner = stripFieldsIn(source, ownFields, resolve, seen);
  seen.delete(source);

  const out = { ...inner };
  clearFieldGroupType(out);
  return out;
}

/** Keep a zone row's own editor-chosen type; clean single components inside it. */
function stripZoneRows(
  value: unknown,
  allowed: string[],
  resolve: ComponentFieldResolver | undefined,
  seen: Set<object>
): unknown {
  if (Array.isArray(value)) {
    return value.map(row => stripZoneRows(row, allowed, resolve, seen));
  }
  if (typeof value !== "object" || value === null) return value;

  const source = value as Record<string, unknown>;
  if (seen.has(source)) return source;

  const rowType = readFieldGroupType(source);
  if (rowType === undefined || !allowed.includes(rowType)) return source;

  const ownFields = resolve?.(rowType);
  if (!ownFields) return source;

  seen.add(source);
  const out = stripFieldsIn(source, ownFields, resolve, seen);
  seen.delete(source);

  return out;
}

/** Reach single components nested inside a group or repeater's stored JSON. */
function stripNestedTags(
  value: unknown,
  fields: FieldConfig[],
  resolve: ComponentFieldResolver | undefined,
  seen: Set<object>
): unknown {
  if (Array.isArray(value)) {
    return value.map(row => stripNestedTags(row, fields, resolve, seen));
  }
  if (typeof value !== "object" || value === null) return value;

  return stripFieldsIn(value as Record<string, unknown>, fields, resolve, seen);
}

/**
 * Every component schema the fields reach, keyed by slug.
 *
 * Resolved to a fixed point so a component embedded in another component is
 * included. The map doubles as the visited set, so a schema that references
 * itself terminates.
 *
 * An UNKNOWN component is simply absent from the map, which stops the walk
 * there rather than failing the write. A lookup that ERRORS is different and
 * propagates: it says nothing about whether the component exists, and treating
 * it as absent would write a snapshot whose nested values carry no type — the
 * exact state a later restore prunes against the wrong schema. Better to fail
 * the save, which the caller can retry, than to store a version that restores
 * incorrectly.
 */
export async function resolveComponentFieldMap(
  fields: FieldConfig[],
  getComponentFields: (slug: string) => Promise<FieldConfig[] | null>
): Promise<Map<string, FieldConfig[]>> {
  const resolved = new Map<string, FieldConfig[]>();

  const slugsIn = (list: FieldConfig[]): string[] => {
    const found: string[] = [];
    for (const field of list) {
      const one = (field as { component?: unknown }).component;
      const many = (field as { components?: unknown }).components;
      if (typeof one === "string") found.push(one);
      if (Array.isArray(many)) {
        for (const slug of many) if (typeof slug === "string") found.push(slug);
      }
      const children = (field as { fields?: unknown }).fields;
      if (Array.isArray(children)) {
        found.push(...slugsIn(children as FieldConfig[]));
      }
    }
    return found;
  };

  let pending = slugsIn(fields);
  while (pending.length > 0) {
    const batch = pending.filter(slug => !resolved.has(slug));
    if (batch.length === 0) break;

    await Promise.all(
      batch.map(async slug => {
        // Not caught: an unknown component already comes back as null, so
        // anything thrown here is an operational failure and is the caller's
        // to handle. See the note above.
        const own = await getComponentFields(slug);
        if (own) resolved.set(slug, own);
      })
    );

    pending = batch.flatMap(slug => slugsIn(resolved.get(slug) ?? []));
  }

  return resolved;
}

/**
 * Rehydrate JSON date strings in a working-draft snapshot to Date objects,
 * in place.
 *
 * A working-draft snapshot is stored as JSON, so a `date` field — at the top
 * level or nested in a single or dynamic-zone component — comes back as an ISO
 * string, while a live read hands the hooks a Drizzle-decoded Date. Walking
 * `addressableFields` flattens unnamed presentational groups (matching the type
 * tagger), so a date or component declared inside one is still reached. A
 * dynamic-zone instance carries its own `_componentType`; a single component
 * takes the field's declared slug.
 */
export function rehydrateSnapshotDates(
  value: Record<string, unknown>,
  fields: FieldConfig[],
  componentSchemas: ComponentSchemas | null
): void {
  for (const field of addressableFields(fields)) {
    const name = (field as { name?: unknown }).name;
    if (typeof name !== "string" || !(name in value)) continue;

    // A timestamp-backed plugin type serializes to a string too, so resolve the
    // storage primitive rather than matching the literal `date` type token.
    if (storageTypeToken(field) === "date") {
      const raw = value[name];
      if (typeof raw === "string") {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) value[name] = parsed;
      }
      continue;
    }

    const single = (field as { component?: unknown }).component;
    const many = (field as { components?: unknown }).components;
    if (typeof single !== "string" && !Array.isArray(many)) continue;

    const compValue = value[name];
    const instances = Array.isArray(compValue)
      ? compValue
      : compValue != null
        ? [compValue]
        : [];
    for (const instance of instances) {
      if (instance === null || typeof instance !== "object") continue;
      const rec = instance as Record<string, unknown>;
      const tagged = readFieldGroupType(rec);
      const slug = tagged ?? (typeof single === "string" ? single : undefined);
      const compFields = slug ? componentSchemas?.get(slug)?.fields : undefined;
      if (compFields) {
        rehydrateSnapshotDates(rec, compFields, componentSchemas);
      }
    }
  }
}
