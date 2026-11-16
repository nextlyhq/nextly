/**
 * The field types the Builder offers: the catalog's types the Builder's save
 * takes, less what a kind leaves out of its picker, plus the types the
 * installed plugins contribute. The field picker draws from this list, and a
 * template is checked against it, so a template never adds a field the picker
 * would not offer.
 *
 * @module lib/builder/offered-field-types
 */
import {
  describeFieldTypes,
  FIELD_TYPE_CATALOG,
  type FieldTypeCatalogEntry,
} from "nextly/field-catalog";

import {
  pickerExcludedTypes,
  type BuilderConfig,
} from "@admin/components/features/schema-builder/builder-config";
import { offeredFieldTypes } from "@admin/components/field-ui/field-type-search";

import { UI_SCHEMA_FIELD_TYPES } from "./ui-schema-mode";

/** The types the Builder's save takes, as the field picker describes them. */
export const BUILDER_FIELD_TYPES = describeFieldTypes<string>(
  FIELD_TYPE_CATALOG.filter(entry =>
    (UI_SCHEMA_FIELD_TYPES as readonly string[]).includes(entry.type)
  )
);

/** Every built-in field type, whether the Builder offers it or not. */
export const BUILT_IN_FIELD_TYPES: ReadonlySet<string> = new Set(
  FIELD_TYPE_CATALOG.map(entry => entry.type)
);

/**
 * The types a kind's picker offers, by the picker's own rule
 * (`offeredFieldTypes`): the Builder's own and the installed plugins' entries
 * types, less the kind's exclusions, which reach a plugin's types too.
 */
export function builderOfferedTypes(
  config: BuilderConfig,
  pluginRows: readonly FieldTypeCatalogEntry<string>[]
): Set<string> {
  return new Set(
    offeredFieldTypes(
      BUILDER_FIELD_TYPES,
      pluginRows,
      pickerExcludedTypes(config)
    ).map(type => type.type)
  );
}
