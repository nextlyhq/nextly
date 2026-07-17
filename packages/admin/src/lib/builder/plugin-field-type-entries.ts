// Turns the plugin field-type metadata delivered via /admin-meta into catalog
// rows the field pickers render, so a plugin-contributed type appears in a
// picker with the same shape (label, hint, icon, category) as a built-in.
//
// A picker "surface" (entries, users, forms) only offers a plugin type whose
// declared `surfaces` include it; an omitted `surfaces` means the entry/single
// surface only, so a type never auto-appears where its author did not opt in.
import type { FieldSurface, FieldTypeCatalogEntry } from "nextly/field-catalog";

import type { PluginMetadata } from "@admin/types/branding";

/** The surface a plugin field type targets when its author declares none. */
const DEFAULT_SURFACES: readonly FieldSurface[] = ["entries"];

/**
 * Title-case a raw type id for a label when the plugin declared none
 * (e.g. `"star-rating"` → `"Star Rating"`, `"rating"` → `"Rating"`).
 */
function defaultLabel(type: string): string {
  return type
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Catalog rows for every plugin field type offered on `surface`, in plugin
 * registration order. Presentation falls back sensibly when a plugin omits a
 * field: label to a title-cased type id, category to `"Advanced"`, icon to
 * `"Puzzle"`, hint to empty. The returned `type` is an arbitrary plugin id
 * (a `string`), not one of the built-in primitives.
 *
 * Built-in vs plugin collisions are the caller's to resolve when merging with
 * the built-in catalog: this helper only projects what the plugins declared.
 */
export function pluginFieldTypeCatalogEntries(
  plugins: readonly PluginMetadata[] | undefined,
  surface: FieldSurface
): FieldTypeCatalogEntry<string>[] {
  return (
    (plugins ?? [])
      // A disabled plugin's field types stay in /admin-meta so existing fields
      // keep rendering, but a disabled plugin must not offer NEW field types in a
      // picker — its behavioral/admin contributions are off.
      .filter(plugin => plugin.enabled !== false)
      .flatMap(plugin => plugin.fieldTypes ?? [])
      .filter(fieldType =>
        (fieldType.surfaces ?? DEFAULT_SURFACES).includes(surface)
      )
      .map(fieldType => ({
        type: fieldType.type,
        label: fieldType.label ?? defaultLabel(fieldType.type),
        category: fieldType.category ?? "Advanced",
        hint: fieldType.description ?? "",
        icon: fieldType.icon ?? "Puzzle",
      }))
  );
}
