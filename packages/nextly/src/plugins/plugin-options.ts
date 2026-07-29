/**
 * Where a plugin field type's options live on a stored field.
 *
 * Options may sit directly on the field, which is what every plugin type does
 * today and what keeps reading them ergonomic. That works only while the key
 * does not collide with one the field schema already declares: the manifest
 * applies the built-in field shape to every field whatever its type, so an
 * option called `options` is judged as a select's choice array and rejected
 * before the type's own check ever runs.
 *
 * The container is the collision-free alternative. Core never interprets what
 * is inside it, so any name is legal there, including the core ones.
 *
 * Both are read. A type is handed one flat view of its options either way, so
 * where an option was stored is not something a plugin author has to track.
 *
 * @module plugins/plugin-options
 */

/** The field key holding options core does not interpret. */
export const PLUGIN_OPTIONS_KEY = "pluginOptions";

/** Whether a value is a `{}` literal that could hold options. */
function isOptionRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** The container's contents, or nothing when the field declares none. */
export function pluginOptionContainer(
  field: object
): Record<string, unknown> | undefined {
  const held = (field as Record<string, unknown>)[PLUGIN_OPTIONS_KEY];
  return isOptionRecord(held) ? held : undefined;
}
