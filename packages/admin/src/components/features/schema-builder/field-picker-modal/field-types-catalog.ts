// The picker renders from the shared field-type catalog shipped by the
// nextly package (`nextly/field-catalog`), so every surface describing a
// field type — this picker, the user-field picker, plugins — reads the same
// labels, categories, hints, and icon names instead of hand-syncing copies.
//
// The admin-local aliases below keep this module's existing import surface
// (`FIELD_TYPES_CATALOG`, `FieldTypeEntry`) stable for its consumers while
// narrowing `type` to the admin's wire union.
import type {
  FieldTypeCatalogEntry,
  FieldTypeCategory,
} from "nextly/field-catalog";
import { FIELD_TYPE_CATALOG } from "nextly/field-catalog";

import type { FieldTypeId } from "@admin/types/collection";

export type { FieldTypeCategory };

// `type` is the open `FieldTypeId` so a plugin-contributed row (merged into the
// picker from the plugin field-type catalog) shares this entry shape with the
// built-ins instead of needing a parallel one.
export interface FieldTypeEntry extends Omit<FieldTypeCatalogEntry, "type"> {
  type: FieldTypeId;
}

/**
 * Stable ordering: Basic -> Advanced -> Media -> Relational -> Structured.
 * Categories are sticky headers in the picker; field rows appear in this
 * order under their header.
 */
export const FIELD_TYPES_CATALOG: readonly FieldTypeEntry[] =
  FIELD_TYPE_CATALOG;
