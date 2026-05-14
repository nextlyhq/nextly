/**
 * Map `password` fields to OpenAPI string schemas with `writeOnly: true`.
 *
 * Mapper-level: passwords are write-only on the wire. The mapper produces a
 * symmetric writeOnly schema for both input and output; the per-collection
 * schema builder is responsible for OMITTING password fields entirely from
 * response schemas. Keeping this layer pure means downstream code never
 * has to reason about whether a "password field's read view exists" — the
 * answer is always no, enforced one level up.
 *
 * Default `minLength: 8` per the `PasswordFieldConfig` JSDoc. Authors can
 * override via either the flat `minLength` or nested `validation.minLength`.
 *
 * @module nextly/openapi/mapping/fields/password
 */

import type { PasswordFieldConfig } from "../../../collections/fields/types/password";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

const DEFAULT_MIN_LENGTH = 8;

export const mapPasswordField: FieldMapper<PasswordFieldConfig> = (
  field
): FieldMapperResult => {
  const minLength =
    field.validation?.minLength ?? field.minLength ?? DEFAULT_MIN_LENGTH;
  const maxLength = field.validation?.maxLength ?? field.maxLength;
  const pattern = field.validation?.pattern;
  const description = field.admin?.description ?? field.label;

  const schema: OpenAPISchema = {
    type: "string",
    writeOnly: true,
    minLength,
  };
  if (maxLength !== undefined) schema.maxLength = maxLength;
  if (pattern !== undefined) schema.pattern = pattern;
  if (description) schema.description = description;

  return { input: { ...schema }, output: { ...schema } };
};
