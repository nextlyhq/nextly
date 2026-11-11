"use client";

/**
 * The plain name of a field type, as the picker shows it: from the shared
 * catalogue, then from the field types plugins contribute, so a row in the
 * outline and the entry in the picker never name a type differently.
 */
import { useCallback, useMemo } from "react";

import { usePluginFieldTypeEntries } from "@admin/components/field-ui";

import { FIELD_TYPES_CATALOG } from "../field-picker-modal/field-types-catalog";

export function useFieldTypeLabel(): (type: string) => string {
  const pluginEntries = usePluginFieldTypeEntries("entries");
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of FIELD_TYPES_CATALOG) map.set(entry.type, entry.label);
    for (const entry of pluginEntries) {
      if (!map.has(entry.type)) map.set(entry.type, entry.label);
    }
    // A field-group field stored under its newer spelling is the same type.
    const fieldGroup = map.get("component");
    if (fieldGroup && !map.has("fieldGroup")) map.set("fieldGroup", fieldGroup);
    return map;
  }, [pluginEntries]);
  // An unknown type is still named, by its own spelling, rather than shown
  // blank: a row the catalogue cannot name is a row a person must still find.
  return useCallback((type: string) => labels.get(type) ?? type, [labels]);
}
