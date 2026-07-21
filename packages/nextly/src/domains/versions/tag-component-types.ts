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

/** The component slug a field names, when it names exactly one. */
function singleComponentSlug(field: FieldConfig): string | undefined {
  // Only the single-component shape. A dynamic zone declares `components` and
  // already stores a type per row, chosen by the editor rather than implied.
  const slug = (field as { component?: unknown }).component;
  return typeof slug === "string" ? slug : undefined;
}

/** Stamp one value, or each element when the field is repeatable. */
function tagValue(value: unknown, slug: string): unknown {
  if (Array.isArray(value)) {
    return value.map(item => tagValue(item, slug));
  }
  if (typeof value !== "object" || value === null) return value;
  return { ...(value as Record<string, unknown>), _componentType: slug };
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
  fields: FieldConfig[]
): Record<string, unknown> {
  const slugByField = new Map<string, string>();
  for (const field of fields) {
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
      tagged[name] = tagValue(tagged[name], slug);
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
  fields: FieldConfig[]
): unknown {
  if (Array.isArray(value)) {
    return value.map(row => tagNestedComponentTypes(row, fields));
  }
  if (typeof value !== "object" || value === null) return value;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };

  for (const field of fields) {
    if (typeof field.name !== "string") continue;
    if (!Object.prototype.hasOwnProperty.call(source, field.name)) continue;

    const slug = singleComponentSlug(field);
    if (slug !== undefined) {
      out[field.name] = tagValue(source[field.name], slug);
      continue;
    }

    // Containers nest, so a component two levels down is still reachable.
    const children = (field as { fields?: unknown }).fields;
    if (Array.isArray(children)) {
      out[field.name] = tagNestedComponentTypes(
        source[field.name],
        children as FieldConfig[]
      );
    }
  }

  return out;
}
