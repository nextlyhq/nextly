/**
 * Map `email` fields to OpenAPI string schemas with `format: "email"`.
 *
 * Email-specific runtime validation happens in Zod; this mapper only
 * documents the wire shape. `EmailFieldConfig` does NOT carry flat
 * `minLength`/`maxLength`/`pattern` fields, so all constraints come from
 * the nested `validation` object.
 *
 * @module nextly/openapi/mapping/fields/email
 */

import type { EmailFieldConfig } from "../../../collections/fields/types/email";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

export const mapEmailField: FieldMapper<EmailFieldConfig> = (
  field
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;
  const v = field.validation;

  const schema: OpenAPISchema = { type: "string", format: "email" };
  if (v?.minLength !== undefined) schema.minLength = v.minLength;
  if (v?.maxLength !== undefined) schema.maxLength = v.maxLength;
  if (v?.pattern !== undefined) schema.pattern = v.pattern;
  if (description) schema.description = description;

  return { input: { ...schema }, output: { ...schema } };
};
