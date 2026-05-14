/**
 * Map `richText` fields to asymmetric input / output OpenAPI schemas.
 *
 * Rich text is the one field type whose request shape and response shape
 * intentionally differ (asymmetric row):
 *
 *   input (POST/PATCH body): Lexical JSON state — modeled as an opaque
 *     object with an `x-nextly-richtext` extension carrying the editor
 *     identifier (and feature list when provided). The Lexical AST is
 *     too unconstrained to spell out structurally in JSON Schema; the
 *     extension is what downstream tooling reads.
 *
 *   output (GET response): `{ html: string, json: object }` envelope.
 *     The server renders Lexical state to HTML for direct consumption
 *     while still returning the raw JSON for clients that prefer to
 *     re-render themselves.
 *
 * Both shapes carry the same `x-nextly-richtext` extension so codegen
 * tools see consistent metadata regardless of direction.
 *
 * @module nextly/openapi/mapping/fields/rich-text
 */

import type { RichTextFieldConfig } from "../../../collections/fields/types/rich-text";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

interface RichTextExtension {
  editor: "lexical";
  features?: readonly string[];
}

function buildExtension(field: RichTextFieldConfig): RichTextExtension {
  const ext: RichTextExtension = { editor: "lexical" };
  // `features !== undefined` covers both "subset of features" and the
  // explicit empty array (plain editor). `undefined` means "use editor
  // defaults," which we don't surface as an extension key.
  if (field.features !== undefined) ext.features = field.features;
  return ext;
}

function lexicalStateSchema(ext: RichTextExtension): OpenAPISchema {
  const schema: OpenAPISchema = { type: "object" };
  (schema as Record<string, unknown>)["x-nextly-richtext"] = { ...ext };
  return schema;
}

export const mapRichTextField: FieldMapper<RichTextFieldConfig> = (
  field
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;
  const ext = buildExtension(field);

  const input = lexicalStateSchema(ext);
  if (description) input.description = description;

  const output: OpenAPISchema = {
    type: "object",
    properties: {
      html: { type: "string" },
      json: lexicalStateSchema(ext),
    },
    required: ["html", "json"],
  };
  if (description) output.description = description;

  return { input, output };
};
