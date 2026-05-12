/**
 * Map `radio` fields to OpenAPI string-with-enum schemas.
 *
 * Radio is always single-value — `RadioFieldConfig` has no `hasMany`
 * (unlike `select`). The shape is otherwise identical to a single-value
 * select: an enum of `option.value`s.
 *
 * Spec: §7.1 row "radio".
 *
 * @module nextly/openapi/mapping/fields/radio
 */

import type { RadioFieldConfig } from "../../../collections/fields/types/radio";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

export const mapRadioField: FieldMapper<RadioFieldConfig> = (
  field
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;
  const enumValues = field.options.map(o => o.value);

  const schema: OpenAPISchema = { type: "string", enum: enumValues };
  if (description) schema.description = description;

  return { input: { ...schema }, output: { ...schema } };
};
