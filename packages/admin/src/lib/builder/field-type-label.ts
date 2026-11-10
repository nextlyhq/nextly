/**
 * The plain name a person reads for a field type.
 *
 * Every Builder surface that names a type (the settings panel, the outline, the
 * save review) reads it from here, so a type is called the same thing
 * wherever it appears and the internal id that stored data uses is never
 * shown in its place.
 *
 * Resolved the way the field picker resolves it: the built-in catalog first
 * (a built-in wins a type-id collision), then the plugin rows offered on the
 * surface asked for, the entries surface by default. The raw id is returned
 * only for a type neither describes.
 * A field group is stored under more than one spelling, and every spelling
 * the field group predicate accepts reads as the catalog's field group.
 *
 * @module lib/builder/field-type-label
 */

import {
  FORM_FIELD_TYPE_CATALOG,
  USER_FIELD_TYPE_CATALOG,
  type FieldSurface,
} from "nextly/field-catalog";
import { isFieldGroupFieldType } from "nextly/field-group-type";
import { useCallback } from "react";

import { FIELD_TYPES_CATALOG } from "@admin/components/features/schema-builder/field-picker-modal/field-types-catalog";
import { usePluginFieldTypeEntries } from "@admin/components/field-ui/usePluginFieldTypeEntries";

/**
 * The built-in types a surface adds to the entries catalog (a form's URL or
 * file upload), named from that surface's own catalog.
 */
function surfaceCatalog(
  surface: FieldSurface
): readonly { type: string; label: string }[] {
  if (surface === "forms") return FORM_FIELD_TYPE_CATALOG;
  if (surface === "users") return USER_FIELD_TYPE_CATALOG;
  return [];
}

/** A function from a type id to the name the picker shows for it. */
export function useFieldTypeLabel(
  // The surface whose plugin types are named; the Builder's own by default.
  surface: FieldSurface = "entries"
): (type: string) => string {
  const pluginTypeEntries = usePluginFieldTypeEntries(surface);
  return useCallback(
    (type: string) =>
      FIELD_TYPES_CATALOG.find(
        entry =>
          entry.type === type ||
          (isFieldGroupFieldType(type) && isFieldGroupFieldType(entry.type))
      )?.label ??
      surfaceCatalog(surface).find(entry => entry.type === type)?.label ??
      pluginTypeEntries.find(entry => entry.type === type)?.label ??
      type,
    [pluginTypeEntries, surface]
  );
}
