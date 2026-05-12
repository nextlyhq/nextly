/**
 * Field mapper registry — keyed by `FieldConfig.type`.
 *
 * Tasks T03–T09 each plug their mapper into this map. Keep entries
 * alphabetized by field-type key for diff hygiene.
 *
 * @module nextly/openapi/mapping/fields
 */

import type { FieldConfig } from "../../../collections/fields/types";

import { mapTextField } from "./text";
import type { FieldMapper } from "./types";

export const fieldMappers: Partial<Record<FieldConfig["type"], FieldMapper>> = {
  text: mapTextField as FieldMapper,
};

export type { FieldMapper, FieldMapperResult, MappingContext } from "./types";
