/**
 * Map `json` fields to either a permissive empty schema OR the attached
 * `field.jsonSchema` (which is ALREADY in JSON Schema form — no Zod
 * conversion needed, despite the original design spec saying otherwise).
 *
 * `JSONFieldConfig` exposes a `jsonSchema?: JSONSchemaDefinition` slot
 * (see `collections/fields/types/json.ts:503`). When present, it's a
 * partial JSON Schema describing the expected JSON value's structure;
 * we pass it through verbatim so SDK generators and Scalar can use it.
 *
 * When absent, the schema is the empty object `{}` — OAS shorthand for
 * "any JSON allowed" — plus an optional description.
 *
 * @module nextly/openapi/mapping/fields/json
 */

import type {
  JSONFieldConfig,
  JSONSchemaDefinition,
} from "../../../collections/fields/types/json";
import type { OpenAPISchema } from "../../types";

import type { FieldMapper, FieldMapperResult } from "./types";

export const mapJsonField: FieldMapper<JSONFieldConfig> = (
  field
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;

  // The attached jsonSchema is already a JSON Schema; pass through.
  // We treat it as `OpenAPISchema`-compatible — JSON Schema and OAS 3.1
  // schemas overlap on the keywords users would put here.
  const baseSchema: OpenAPISchema = field.jsonSchema
    ? cloneSchema(field.jsonSchema)
    : {};

  if (description) {
    // admin.description wins over any schema-level description.
    baseSchema.description = description;
  }

  return {
    input: cloneSchema(baseSchema),
    output: cloneSchema(baseSchema),
  };
};

function cloneSchema<T extends OpenAPISchema | JSONSchemaDefinition>(
  schema: T
): OpenAPISchema {
  // Structured clone keeps the result independent of caller mutation while
  // preserving nested arrays/objects. JSON-safe because JSON Schema only
  // contains JSON-serializable values.
  return JSON.parse(JSON.stringify(schema)) as OpenAPISchema;
}
