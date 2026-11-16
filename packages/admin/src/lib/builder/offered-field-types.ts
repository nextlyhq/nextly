/**
 * The field types the Builder offers: the catalog's types the Builder's save
 * takes, less what a kind leaves out of its picker, plus the types the
 * installed plugins contribute. The field picker draws from this list, and a
 * template is checked against it, so a template never adds a field the picker
 * would not offer.
 *
 * @module lib/builder/offered-field-types
 */
import { FIELD_TYPE_CATALOG } from "nextly/field-catalog";

import {
  pickerExcludedTypes,
  type BuilderConfig,
} from "@admin/components/features/schema-builder/builder-config";

import { UI_SCHEMA_FIELD_TYPES } from "./ui-schema-mode";

/** The catalog's entries for the types the Builder's save takes. */
export const BUILDER_FIELD_TYPE_ENTRIES = FIELD_TYPE_CATALOG.filter(entry =>
  (UI_SCHEMA_FIELD_TYPES as readonly string[]).includes(entry.type)
);

/** Every built-in field type, whether the Builder offers it or not. */
export const BUILT_IN_FIELD_TYPES: ReadonlySet<string> = new Set(
  FIELD_TYPE_CATALOG.map(entry => entry.type)
);

/**
 * The types a kind's picker offers: the Builder's own, less the kind's
 * exclusions, and every type an installed plugin contributes.
 */
export function builderOfferedTypes(
  config: BuilderConfig,
  pluginTypes: readonly string[]
): Set<string> {
  const excluded = new Set<string>(pickerExcludedTypes(config));
  return new Set([
    ...BUILDER_FIELD_TYPE_ENTRIES.map(entry => entry.type).filter(
      type => !excluded.has(type)
    ),
    ...pluginTypes,
  ]);
}
