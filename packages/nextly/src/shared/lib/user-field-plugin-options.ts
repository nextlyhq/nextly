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

  return Object.keys(carried).length > 0 ? carried : null;
}
