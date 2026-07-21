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
function addressableFields(fields: FieldConfig[]): FieldConfig[] {
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
  seen: Set<string> = new Set()
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => tagValue(item, slug, resolve, seen));
  }
  if (typeof value !== "object" || value === null) return value;

  const source = value as Record<string, unknown>;

  // A component can reach itself through a descendant; a slug already walked is
  // not followed again.
  const ownFields = seen.has(slug) ? undefined : resolve?.(slug);
  const inner = ownFields
    ? (tagNestedComponentTypes(
        source,
        ownFields,
        resolve,
        new Set([...seen, slug])
      ) as Record<string, unknown>)
    : source;

  return { ...inner, _componentType: slug };
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
  const slugByField = new Map<string, string>();
  for (const field of addressableFields(fields)) {
    const slug = singleComponentSlug(field);
    if (slug !== undefined && typeof field.name === "string") {
      slugByField.set(field.name, slug);
    }
  }

  if (slugByField.size === 0) return components;

  const tagged: Record<string, unknown> = { ...components };
  for (const [name, slug] of slugByField) {
    // Own properties only. `in` also matches inherited ones, so a field named
    // `constructor` or `__proto__` would be treated as captured and tagged
    // when nothing of the sort was read back.
    if (Object.prototype.hasOwnProperty.call(tagged, name)) {
      tagged[name] = tagValue(tagged[name], slug, resolve);
    }
  }
  return tagged;
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
  seen: Set<string> = new Set()
): unknown {
  if (Array.isArray(value)) {
    return value.map(row =>
      tagNestedComponentTypes(row, fields, resolve, seen)
    );
  }
  if (typeof value !== "object" || value === null) return value;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };

  for (const field of addressableFields(fields)) {
    if (typeof field.name !== "string") continue;
    if (!Object.prototype.hasOwnProperty.call(source, field.name)) continue;

    const slug = singleComponentSlug(field);
    if (slug !== undefined) {
      out[field.name] = tagValue(source[field.name], slug, resolve, seen);
      continue;
    }

    // Containers nest, so a component two levels down is still reachable.
    const children = (field as { fields?: unknown }).fields;
    if (Array.isArray(children)) {
      out[field.name] = tagNestedComponentTypes(
        source[field.name],
        children as FieldConfig[],
        resolve,
        seen
      );
    }
  }

  return out;
}

/**
 * Every component schema the fields reach, keyed by slug.
 *
 * Resolved to a fixed point so a component embedded in another component is
 * included. The map doubles as the visited set, so a schema that references
 * itself terminates. A slug that fails to resolve is simply absent, which stops
 * the walk there rather than failing the write — a snapshot missing one tag is
 * recoverable; a rejected save is not.
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
        try {
          const own = await getComponentFields(slug);
          if (own) resolved.set(slug, own);
        } catch {
          // Unresolvable: leave it out. See the note above — a missing tag is
          // recoverable, a failed write is not.
        }
      })
    );

    pending = batch.flatMap(slug => slugsIn(resolved.get(slug) ?? []));
  }

  return resolved;
}
