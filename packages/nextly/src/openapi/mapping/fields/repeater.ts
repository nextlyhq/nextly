/**
 * Map `repeater` fields to an OpenAPI array of $refs to the row-item schema.
 *
 * The repeater mapper itself only emits the array shape and a $ref to a
 * named item schema (`<Owner>__<FieldName>Item`). The actual item-schema
 * registration happens at the collection level (via
 * `deriveNestedItemSchemas`), which walks the field tree and registers a
 * composed object schema for each repeater field. Standalone tests of the
 * mapper will have a dangling $ref — that's expected.
 *
 * Naming convention (frozen public contract):
 *   <Owner>__<FieldName>Item   e.g.  Post__BlocksItem, Page__SectionsItem
 *
 * @module nextly/openapi/mapping/fields/repeater
 */

import type { RepeaterFieldConfig } from "../../../collections/fields/types/repeater";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

function pascalize(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

export const mapRepeaterField: FieldMapper<RepeaterFieldConfig> = (
  field,
  ctx
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;
  const itemSchemaName = `${ctx.ownerSlug}__${pascalize(field.name)}Item`;

  const schema: OpenAPISchema = {
    type: "array",
    items: ctx.schemaRef(itemSchemaName),
  };
  if (field.minRows !== undefined) schema.minItems = field.minRows;
  if (field.maxRows !== undefined) schema.maxItems = field.maxRows;
  if (description) schema.description = description;

  return {
    input: { ...schema, items: ctx.schemaRef(itemSchemaName) },
    output: { ...schema, items: ctx.schemaRef(itemSchemaName) },
  };
};
