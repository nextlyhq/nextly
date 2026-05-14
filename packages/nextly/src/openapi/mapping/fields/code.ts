/**
 * Map `code` fields to OpenAPI string schemas, with a non-standard
 * `x-nextly-code-language` extension carrying the syntax-highlight hint.
 *
 * The hint is advisory only (Scalar / Swagger UI ignore it); custom doc
 * renderers can read it to enable per-language syntax highlighting in
 * request/response examples.
 *
 * @module nextly/openapi/mapping/fields/code
 */

import type { CodeFieldConfig } from "../../../collections/fields/types/code";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

export const mapCodeField: FieldMapper<CodeFieldConfig> = (
  field
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;
  const v = field.validation;

  const schema: OpenAPISchema = { type: "string" };
  if (v?.minLength !== undefined) schema.minLength = v.minLength;
  if (v?.maxLength !== undefined) schema.maxLength = v.maxLength;
  if (v?.pattern !== undefined) schema.pattern = v.pattern;
  if (description) schema.description = description;

  if (field.admin?.language !== undefined) {
    // Custom OAS extension. Use bracket access because the `OpenAPISchema`
    // type doesn't include `x-*` keys; OAS 3.1 allows any key starting with
    // `x-` and serializes verbatim.
    (schema as Record<string, unknown>)["x-nextly-code-language"] =
      field.admin.language;
  }

  return { input: { ...schema }, output: { ...schema } };
};
