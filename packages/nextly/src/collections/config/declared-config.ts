/**
 * What `defineCollection` and `defineSingle` both make of the config an
 * author writes: a label read from a slug, and the authored fields as the
 * rest of the system reads them. One module, so the two definitions cannot
 * drift apart.
 *
 * @module collections/config/declared-config
 */
import { columnsDeclaredBy } from "../../domains/schema/services/field-column-descriptor";
import { markSystemField } from "../../shared/lib/declared-entity-trace";
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

/**
 * The system fields (`title`, `slug`) a collection or a Single has beside its author's fields:
 * each one whose column those fields do not already own. Every such table carries both columns,
 * and an author's own definition of one takes priority.
 *
 * Keyed by the COLUMN each field becomes, not by its declared name. A field named `Title` owns
 * the `title` column, so adding the system one beside it declares that column twice and the
 * table cannot be created; this asks the same question the generators do.
 *
 * Both are SHARED (`localized: false`): localizing the title or slug is a deliberate opt-in
 * through a field the author declares, not a side effect of text fields localizing by default,
 * which would move the identity columns into the companion `_locales` table.
 *
 * Each is recorded as a system field (`markSystemField`), so the configuration's check can tell
 * an entity that declares no field of its own from one whose plugin added a field of that name.
 */
export function systemFieldsBeside(
  fields: readonly AuthorableFieldConfig[]
): Array<FieldConfig & { name: string }> {
  const owned = columnsDeclaredBy(fields);
  const systemFields: Array<FieldConfig & { name: string }> = [];
  if (!owned.has("title")) {
    systemFields.push(
      markSystemField({
        type: "text",
        name: "title",
        label: "Title",
        required: true,
        localized: false,
      })
    );
  }
  if (!owned.has("slug")) {
    systemFields.push(
      markSystemField({
        type: "text",
        name: "slug",
        label: "Slug",
        required: true,
        unique: true,
        localized: false,
      })
    );
  }
  return systemFields;
}
