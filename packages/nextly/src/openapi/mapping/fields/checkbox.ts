/**
 * Map `checkbox` fields to OpenAPI boolean schemas.
 *
 * `CheckboxFieldConfig` does NOT support `hasMany` (unlike text/number);
 * it's always a single boolean. Earlier plan revisions misclassified this.
 *
 * @module nextly/openapi/mapping/fields/checkbox
 */

import type { CheckboxFieldConfig } from "../../../collections/fields/types/checkbox";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

export const mapCheckboxField: FieldMapper<CheckboxFieldConfig> = (
  field
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;
  const schema: OpenAPISchema = { type: "boolean" };
  if (description) schema.description = description;
  return { input: { ...schema }, output: { ...schema } };
};
