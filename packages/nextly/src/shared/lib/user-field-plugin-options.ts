/**
 * Folding a user field's declared options into the flat record shape.
 *
 * Shared because two callers must agree on what a field declared: codegen,
 * which writes the generated types, and the startup sync that persists the
 * definition rows. If they folded differently, a plugin's editor would be
 * handed options the generated types said it would not have.
 *
 * @module shared/lib/user-field-plugin-options
 */

import { NextlyError } from "../../errors/nextly-error";
import { RESERVED_PLUGIN_OPTION_KEYS } from "../../plugins/plugin-options";
import type { UserFieldConfig } from "../../users";

/**
 * Properties the user-field record models itself. Anything else on a declared
 * field belongs to whoever declared its type, and is carried rather than
 * rebuilt so a plugin type's options survive into codegen.
 */
const MODELLED_USER_FIELD_KEYS: ReadonlySet<string> = new Set([
  "name",
  "label",
  "type",
  "required",
  "defaultValue",
  "options",
  "hasMany",
  "minLength",
  "maxLength",
  "min",
  "max",
  "placeholder",
  "description",
  "admin",
  "pluginOptions",
]);

/**
 * Modelled keys the record does not expose verbatim under the same name.
 *
 * Everything else in `MODELLED_USER_FIELD_KEYS` reaches the record unchanged,
 * so reading it off the record is reading what was declared.
 */
const NORMALIZED_USER_FIELD_KEYS: readonly string[] = [
  "min",
  "max",
  "defaultValue",
  "options",
  // Only `placeholder` and `description` are hoisted out of it onto the record,
  // so a type reading `field.admin` would otherwise find nothing.
  "admin",
];

/**
 * Whether a carried option is one of the shapes JSON actually has.
 *
 * The options are persisted as JSON and read back to rebuild the field the
 * plugin's editor is handed, so a value JSON cannot represent does not merely
 * store awkwardly — it reaches the component as something else. A `Set` or
 * `Map` becomes `{}`, a `Date` becomes a string, a function or `undefined`
 * disappears, and a `BigInt` or a cycle throws mid-serialization and takes the
 * whole code-field sync with it.
 *
 * Tested structurally rather than by round-tripping the encoding: `new Set()`
 * and `{}` serialize to the same bytes, so a re-serialize comparison calls the
 * lossy conversion a success. What matters is whether the value was already one
 * of JSON's own shapes, not whether it can be coerced into one.
 */
function isJsonShape(value: unknown, path: Set<object> = new Set()): boolean {
  if (value === null) return true;
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return true;
  if (kind === "number") return Number.isFinite(value);
  if (kind !== "object") return false;

  const asObject = value as object;
  // The ACTIVE path, not everything visited: a cycle is a reference to
  // something still being walked. Keeping every object ever seen would reject
  // one referenced twice without a cycle, which serializes perfectly well at
  // both locations.
  if (path.has(asObject)) return false;
  path.add(asObject);
  try {
    if (Array.isArray(value)) {
      // Indexed rather than `every`, which skips holes entirely and so calls a
      // sparse array clean. Read by index a hole is `undefined`, which the
      // non-object branch above refuses — and it has to be refused, because
      // serialization turns each hole into `null` and the component then
      // receives different data.
      for (let index = 0; index < value.length; index++) {
        if (!isJsonShape(value[index], path)) return false;
      }
      return true;
    }
    // Only a plain object: anything with a different prototype (Date, Set, Map,
    // a class instance) loses what makes it that thing when serialized.
    const proto = Object.getPrototypeOf(asObject);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(asObject).every(entry => isJsonShape(entry, path));
  } finally {
    // Popped so a sibling may reference the same object; only an ancestor
    // reference is a cycle.
    path.delete(asObject);
  }
}

/**
 * Refuse carried options the JSON column cannot hold unchanged.
 *
 * Raised where the options are folded rather than at the write, so codegen and
 * the startup sync reject the same declaration for the same reason instead of
 * one generating types for a field the other cannot store.
 */
function assertJsonSafeOptions(
  carried: Record<string, unknown>,
  fieldName: unknown
): void {
  const offending = Object.keys(carried).filter(
    key => !isJsonShape(carried[key])
  );
  if (offending.length === 0) return;
  throw NextlyError.validation({
    errors: offending.map(key => ({
      path: `users.fields.${String(fieldName)}.${key}`,
      code: "INVALID_TYPE",
      message:
        `'${key}' cannot be stored: a user field's options are persisted as ` +
        `JSON, and this value does not survive that unchanged`,
    })),
  });
}

/** The declared options a user field carries beyond the modelled set. */
export function carriedUserFieldOptions(
  field: UserFieldConfig
): Record<string, unknown> | null {
  // Read positionally rather than through the union's per-type members, since
  // which of these a given field declares depends on its type.
  const declared = field as unknown as Record<string, unknown>;
  const carried: Record<string, unknown> = {};
  const collect = (key: string, value: unknown): void => {
    if (value === undefined) return;
    // Defined, not assigned: an option named after a prototype accessor would
    // otherwise repoint this object instead of being collected.
    Object.defineProperty(carried, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  };

  for (const [key, value] of Object.entries(field)) {
    if (MODELLED_USER_FIELD_KEYS.has(key)) continue;
    collect(key, value);
  }

  // The record renames or normalizes a few of the modelled keys — `min`/`max`
  // become `minValue`/`maxValue`, `defaultValue` is stringified, `options` is
  // rewritten to `{label, value}` pairs — so a field type reading them by their
  // declared names would find the wrong thing or nothing. Their originals are
  // carried so the callbacks see the field as it was written.
  for (const key of NORMALIZED_USER_FIELD_KEYS) {
    collect(key, declared[key]);
  }

  const container = (field as { pluginOptions?: unknown }).pluginOptions;
  if (container !== null && typeof container === "object") {
    // The instance restates `type` and `name` as its identity after folding, so
    // an option under either would be replaced before the type that declared it
    // could read it. Refused rather than carried and silently lost.
    const reserved = Object.keys(container).filter(key =>
      RESERVED_PLUGIN_OPTION_KEYS.has(key)
    );
    if (reserved.length > 0) {
      throw NextlyError.validation({
        errors: reserved.map(key => ({
          path: `users.fields.${String((field as { name?: unknown }).name)}.pluginOptions.${key}`,
          code: "RESERVED",
          message:
            `'${key}' cannot be used as a plugin option: it states which ` +
            `field the type is looking at`,
        })),
      });
    }
    for (const [key, value] of Object.entries(container)) collect(key, value);
  }

  if (Object.keys(carried).length === 0) return null;
  assertJsonSafeOptions(carried, (field as { name?: unknown }).name);
  return carried;
}
