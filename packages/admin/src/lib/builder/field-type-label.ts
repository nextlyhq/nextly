/**
 * The plain name a person reads for a field type.
 *
 * Every Builder surface that names a type (the field sheet, the outline, the
 * save review) reads it from here, so a type is called the same thing
 * wherever it appears and the internal id that stored data uses is never
 * shown in its place.
 *
 * Resolved the way the field picker resolves it: the built-in catalog first
 * (a built-in wins a type-id collision), then the plugin rows offered on the
 * entries surface. The raw id is returned only for a type neither describes.
 * A field group is stored under more than one spelling, and every spelling
 * the field group predicate accepts reads as the catalog's field group.
 *
 * @module lib/builder/field-type-label
 */

import { isFieldGroupFieldType } from "nextly/field-group-type";
import { useCallback } from "react";

import { FIELD_TYPES_CATALOG } from "@admin/components/features/schema-builder/field-picker-modal/field-types-catalog";
import { usePluginFieldTypeEntries } from "@admin/components/field-ui";

/** A function from a type id to the name the picker shows for it. */
export function useFieldTypeLabel(): (type: string) => string {
  const pluginTypeEntries = usePluginFieldTypeEntries("entries");
  return useCallback(
    (type: string) =>
      FIELD_TYPES_CATALOG.find(
        entry =>
          entry.type === type ||
          (isFieldGroupFieldType(type) && isFieldGroupFieldType(entry.type))
      )?.label ??
      pluginTypeEntries.find(entry => entry.type === type)?.label ??
      type,
    [pluginTypeEntries]
  );
}
