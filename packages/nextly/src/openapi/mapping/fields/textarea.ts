/**
 * Map `textarea` fields to OpenAPI string schemas.
 *
 * Identical shape to `text` but never emits `format` (textareas are plain
 * multi-line strings; the renderer concern lives in `admin.rows` / `resize`,
 * which is UI-only and not surfaced in the spec).
 *
 * Honors both nested `validation` and legacy flat `minLength`/`maxLength`;
 * nested wins per the `TextareaFieldConfig.validation` JSDoc note.
 *
 * @module nextly/openapi/mapping/fields/textarea
 */

import type { TextareaFieldConfig } from "../../../collections/fields/types/textarea";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

export const mapTextareaField: FieldMapper<TextareaFieldConfig> = (
  field
): FieldMapperResult => {
  const minLength = field.validation?.minLength ?? field.minLength;
  const maxLength = field.validation?.maxLength ?? field.maxLength;
  const description = field.admin?.description ?? field.label;

  const schema: OpenAPISchema = { type: "string" };
  if (minLength !== undefined) schema.minLength = minLength;
  if (maxLength !== undefined) schema.maxLength = maxLength;
  if (description) schema.description = description;

  return { input: { ...schema }, output: { ...schema } };
};
