/**
 * Map `chips` fields to OpenAPI array-of-string schemas.
 *
 * Chips fields are always arrays — there's no scalar form. The runtime
 * also enforces uniqueness (the UI dedupes), so the spec declares
 * `uniqueItems: true` which is honest and useful for client codegen.
 *
 * Constraints use chips-specific names (`minChips` / `maxChips`), NOT the
 * generic `validation.minRows` / `maxRows`. The field has no nested
 * `validation` object.
 *
 * @module nextly/openapi/mapping/fields/chips
 */

import type { ChipsFieldConfig } from "../../../collections/fields/types/chips";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

export const mapChipsField: FieldMapper<ChipsFieldConfig> = (
  field
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;

  const schema: OpenAPISchema = {
    type: "array",
    items: { type: "string" },
    uniqueItems: true,
  };
  if (field.minChips !== undefined) schema.minItems = field.minChips;
  if (field.maxChips !== undefined) schema.maxItems = field.maxChips;
  if (description) schema.description = description;

  return {
    input: { ...schema, items: { type: "string" } },
    output: { ...schema, items: { type: "string" } },
  };
};
