/**
 * Map `text` fields to OpenAPI string (or array-of-string) schemas.
 *
 * Honors both the nested `validation` object and the legacy flat
 * `minLength`/`maxLength` fields; nested wins when both are set, matching
 * the source-of-truth note on `TextFieldConfig.validation`.
 *
 * @module nextly/openapi/mapping/fields/text
 */

import type { TextFieldConfig } from "../../../collections/fields/types/text";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

export const mapTextField: FieldMapper<TextFieldConfig> = (
  field
): FieldMapperResult => {
  // Nested validation wins over flat fields per TextFieldConfig.validation
  // JSDoc ("newly written code should prefer this shape").
  const minLength = field.validation?.minLength ?? field.minLength;
  const maxLength = field.validation?.maxLength ?? field.maxLength;
  const pattern = field.validation?.pattern;
  const description = field.admin?.description ?? field.label;

  const stringSchema: OpenAPISchema = { type: "string" };
  if (minLength !== undefined) stringSchema.minLength = minLength;
  if (maxLength !== undefined) stringSchema.maxLength = maxLength;
  if (pattern !== undefined) stringSchema.pattern = pattern;

  if (field.hasMany) {
    // Array constraints live on the array; per-item constraints stay on items.
    const arraySchema: OpenAPISchema = {
      type: "array",
      items: { ...stringSchema },
    };
    const minRows = field.validation?.minRows ?? field.minRows;
    const maxRows = field.validation?.maxRows ?? field.maxRows;
    if (minRows !== undefined) arraySchema.minItems = minRows;
    if (maxRows !== undefined) arraySchema.maxItems = maxRows;
    if (description) arraySchema.description = description;
    // Return independent objects so a downstream mutation (e.g. adding
    // `writeOnly`) on one variant doesn't leak into the other.
    return {
      input: { ...arraySchema, items: { ...stringSchema } },
      output: { ...arraySchema, items: { ...stringSchema } },
    };
  }

  if (description) stringSchema.description = description;
  return { input: { ...stringSchema }, output: { ...stringSchema } };
};
