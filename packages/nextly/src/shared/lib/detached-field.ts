/**
 * The copy of a field a plugin's own code is handed.
 *
 * Two seams pass a field into code core does not own: `PluginFieldType.validate`
 * on a write, and `PluginFieldType.validateOptions` when a declaration is
 * registered. Both hand over the same shape and make the same promise — that
 * editing it changes nothing — so the copy is made once here rather than twice
 * with a chance to disagree.
 *
 * @module shared/lib/detached-field
 */
import type { PluginFieldInstance } from "../../plugins/contributions";

import { defineOwnProperty } from "./own-property";

/** Whether a value is a `{}` literal, as opposed to a Date, class instance, or null. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Rebuild a value so a validator holding it cannot reach the schema through it.
 *
 * Covers the shapes an option is written in: plain records, arrays, and the
 * mutable built-ins a config can carry (a `Date` bound, a `Set` of allowed
 * names, a `Map` of labels). What stays shared is what cannot be copied without
 * changing what it is — a function, which is behavior rather than option data,
 * and an instance of a class this code knows nothing about, whose constructor
 * and private state a generic copy cannot reproduce.
 */
function detachValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(detachValue);
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Set) return new Set([...value].map(detachValue));
  if (value instanceof Map) {
    // Keys too: an object used as a key is as reachable through the copy as a
    // value is, and mutating one changes the live declaration just the same.
    return new Map(
      [...value].map(([key, held]) => [detachValue(key), detachValue(held)])
    );
  }
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      defineOwnProperty(copy, key, detachValue(nested));
    }
    return copy;
  }
  return value;
}

/**
 * The field instance plugin code is handed.
 *
 * Detached all the way down, not spread one level: a validator reads its own
 * options off the instance, and those options are routinely nested
 * (`blocks.allow`, `validation.*`, `fields`). A shallow copy would leave every
 * one of them pointing at the live schema, so a validator that sorted or
 * pushed to an option array would change validation for every later write.
 */
export function detachedField(field: {
  name?: string;
  type: string;
}): PluginFieldInstance {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(field)) {
    defineOwnProperty(copy, key, detachValue(value));
  }
  // Spread defines rather than assigns, so an own `__proto__` carried by the
  // copy survives this step; `type` and `name` are restated because they are
  // the two the instance contract guarantees.
  return { ...copy, type: field.type, name: field.name };
}
