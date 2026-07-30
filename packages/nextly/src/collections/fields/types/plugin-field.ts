/**
 * Authoring a field whose type a plugin contributed.
 *
 * `DataFieldConfig` is a closed union of the built-in shapes, which is what
 * makes a malformed built-in a compile error: `{ type: "select" }` without its
 * `options` matches no arm. A contributed type has no arm — its id belongs to
 * whichever plugin is installed — so a code-first declaration of one did not
 * type-check at all, and could only be written with a cast.
 *
 * Widening the union with an open arm would lose the property that closes it:
 * `string & {}` accepts every literal, so a malformed `select` would satisfy
 * the open arm instead of failing against its own. A symbol nothing else can
 * name is what keeps the two apart, and `pluginField()` is the only thing that
 * sets it — so reaching the open arm is a decision the author made rather than
 * a shape falling through to it.
 *
 * The same arrangement `pluginUserField()` uses for the users surface, for the
 * same reason. Kept symmetrical deliberately: one mechanism to learn, and a
 * plugin author moving between surfaces meets no second convention.
 *
 * @module collections/fields/types/plugin-field
 */

import type { FieldType } from "./base";

import type { FieldConfig } from "./index";

/**
 * The marker that admits a declaration to the open arm.
 *
 * `Symbol.for` rather than a fresh symbol: two copies of this module — a
 * pnpm-duplicated install, a bundler that did not dedupe — must agree on the
 * brand, or a field marked by one would not be recognised by the other.
 */
export const pluginFieldBrand: unique symbol = Symbol.for(
  "nextly.plugin-data-field"
);

/** A field declaration whose type a plugin contributed. */
export interface PluginFieldInput {
  name: string;
  /**
   * The contributed type's id. Open, because it belongs to a plugin rather
   * than to this union.
   */
  type: string & {};
  label?: string;
  required?: boolean;
  /**
   * Options belonging to the field's own plugin type.
   *
   * Optional: a type may take none, and one whose option names collide with
   * nothing the built-in shapes declare may write them directly on the field.
   * Requiring an empty container would make this narrower than the runtime.
   */
  pluginOptions?: Record<string, unknown>;
  /** Anything else the declared type reads for itself. */
  [option: string]: unknown;
}

/** The same declaration once `pluginField()` has marked it. */
export interface PluginDataFieldConfig extends PluginFieldInput {
  readonly [pluginFieldBrand]: true;
}

/**
 * Declare a field whose type a plugin contributed.
 *
 * A built-in token is refused: marking one would put it on the open arm, where
 * its own shape is never checked — `{ type: "select" }` would satisfy the
 * union without the `options` a select requires, which is exactly what the
 * marker exists to prevent.
 *
 * @example
 * ```ts
 * defineCollection({
 *   slug: "pages",
 *   fields: [text({ name: "title" }), pluginField({ name: "score", type: "star-rating" })],
 * })
 * ```
 */
export function pluginField<const T extends PluginFieldInput>(
  field: T &
    (T["type"] extends FieldType
      ? {
          type: "this is a built-in field type; declare it with its own factory so its shape is checked";
        }
      : unknown)
): PluginDataFieldConfig {
  // Built rather than asserted, so the value really carries what its type says.
  // A symbol key is invisible to `JSON.stringify` and to `Object.keys`, so the
  // declaration serializes and enumerates exactly as it was written.
  return { ...field, [pluginFieldBrand]: true };
}

/**
 * What a config may declare a field as: a built-in shape, or a contributed one
 * that went through `pluginField()`.
 *
 * Only the authoring surfaces use this. `FieldConfig` itself stays a closed
 * union of the built-in shapes, because a member carrying an index signature
 * widens property access across the whole union — `field.minLength` would
 * become `{} | null` for every consumer that reads it. The openness a
 * contributed type needs belongs at the boundary where a schema is written,
 * not in the type every internal reader shares.
 */
export type AuthorableFieldConfig = FieldConfig | PluginDataFieldConfig;
