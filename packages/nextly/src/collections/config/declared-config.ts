/**
 * What `defineCollection` and `defineSingle` both make of the config an
 * author writes: a label read from a slug, and the authored fields as the
 * rest of the system reads them. One module, so the two definitions cannot
 * drift apart.
 *
 * @module collections/config/declared-config
 */
import type { AuthorableFieldConfig, FieldConfig } from "../fields/types";

/**
 * Converts a slug to title case for display.
 *
 * @param str - The string to convert
 * @returns Title-cased string
 *
 * @example
 * ```typescript
 * toTitleCase('blog-posts') // 'Blog Posts'
 * toTitleCase('header_nav') // 'Header Nav'
 * toTitleCase('users') // 'Users'
 * ```
 */
export function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * The authored fields as the rest of the system reads them.
 *
 * A contributed declaration is structurally a field — a name, a type, and the
 * options its own type reads — and every internal consumer dispatches on
 * `type` as a string. The authoring widening exists so a plugin type can be
 * written down; it is dropped at this boundary, after validation, rather than
 * carried into the union every reader shares, where an index-signature member
 * would widen property access for all of them.
 */
export function asDeclaredFields(
  fields: readonly AuthorableFieldConfig[]
): FieldConfig[] {
  return fields as FieldConfig[];
}
