"use client";

// Reads plugin-contributed field types for one picker surface from the admin
// branding context and projects them into catalog rows a FieldTypePicker can
// render. Kept a hook (not a prop) so every surface — the admin's own builders
// and, via the plugin SDK, plugin field editors — merges plugin types the same
// way without threading branding through their component trees.
import type { FieldSurface, FieldTypeCatalogEntry } from "nextly/field-catalog";
import { useMemo } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import { pluginFieldTypeCatalogEntries } from "@admin/lib/builder/plugin-field-type-entries";

/**
 * Catalog rows for the plugin field types offered on `surface`, memoized
 * against the installed plugins. Merge these after a surface's built-in
 * catalog (built-ins win on a type-id collision). Returns an empty array when
 * no plugin contributes a field type for the surface.
 */
export function usePluginFieldTypeEntries(
  surface: FieldSurface
): FieldTypeCatalogEntry<string>[] {
  const branding = useBranding();
  return useMemo(
    () => pluginFieldTypeCatalogEntries(branding.plugins, surface),
    [branding.plugins, surface]
  );
}
