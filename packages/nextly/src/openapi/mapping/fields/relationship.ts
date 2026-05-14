/**
 * Map `relationship` fields to OpenAPI document-reference schemas.
 *
 * Per the "Honest oneOf" decision, the response shape declares the
 * depth-dependent form truthfully: unpopulated returns the ID (or
 * polymorphic { relationTo, value }), populated returns the full document.
 *
 *   non-poly single:   input string,                output oneOf [string, $ref]
 *   non-poly hasMany:  input array<string>,         output oneOf [array<string>, array<$ref>]
 *   polymorphic:       input { relationTo, value }, output oneOf [poly, $ref(A), $ref(B), ...]
 *
 * Polymorphic schemas also carry an `x-nextly-relation-to` extension so
 * downstream tooling can list valid targets without parsing oneOf.
 *
 * @module nextly/openapi/mapping/fields/relationship
 */

import type { RelationshipFieldConfig } from "../../../collections/fields/types/relationship";
import type { OpenAPISchema } from "../../types";

import { buildPolymorphicRefObject, slugToSchemaName } from "./_refs";
import type { FieldMapper, FieldMapperResult, MappingContext } from "./types";

export const mapRelationshipField: FieldMapper<RelationshipFieldConfig> = (
  field,
  ctx
): FieldMapperResult => {
  const description = field.admin?.description ?? field.label;
  const isPolymorphic = Array.isArray(field.relationTo);
  const targets: readonly string[] = isPolymorphic
    ? (field.relationTo as string[])
    : [field.relationTo as string];

  return buildDocumentReferenceSchemas({
    targets,
    isPolymorphic,
    hasMany: field.hasMany === true,
    minRows: field.minRows,
    maxRows: field.maxRows,
    description,
    ctx,
  });
};

/**
 * Shared assembly logic for both relationship and upload mappers. Kept
 * exported so `upload.ts` can call the exact same path; not part of the
 * public API.
 */
export function buildDocumentReferenceSchemas(args: {
  targets: readonly string[];
  isPolymorphic: boolean;
  hasMany: boolean;
  minRows?: number;
  maxRows?: number;
  description?: string;
  ctx: MappingContext;
}): FieldMapperResult {
  const {
    targets,
    isPolymorphic,
    hasMany,
    minRows,
    maxRows,
    description,
    ctx,
  } = args;
  const refs = targets.map(slug => ctx.schemaRef(slugToSchemaName(slug)));

  const scalarInput = (): OpenAPISchema =>
    isPolymorphic
      ? buildPolymorphicRefObject(targets)
      : { type: "string", description: "Document ID" };

  const scalarOutputOptions = (): OpenAPISchema[] =>
    isPolymorphic
      ? [buildPolymorphicRefObject(targets), ...refs]
      : [{ type: "string" }, ...refs];

  if (hasMany) {
    const itemInput = scalarInput();
    const arrayInput: OpenAPISchema = {
      type: "array",
      items: itemInput,
    };
    const arrayOutput: OpenAPISchema = {
      oneOf: scalarOutputOptions().map(item => ({
        type: "array",
        items: item,
      })),
    };
    if (minRows !== undefined) arrayInput.minItems = minRows;
    if (maxRows !== undefined) arrayInput.maxItems = maxRows;
    if (isPolymorphic) {
      setExtension(arrayInput, "x-nextly-relation-to", [...targets]);
      setExtension(arrayOutput, "x-nextly-relation-to", [...targets]);
    }
    if (description) {
      arrayInput.description = description;
      arrayOutput.description = description;
    }
    return { input: arrayInput, output: arrayOutput };
  }

  const input = scalarInput();
  const output: OpenAPISchema = { oneOf: scalarOutputOptions() };
  if (isPolymorphic) {
    setExtension(input, "x-nextly-relation-to", [...targets]);
    setExtension(output, "x-nextly-relation-to", [...targets]);
  }
  if (description) {
    input.description = description;
    output.description = description;
  }
  return { input, output };
}

/**
 * Attach an OAS extension (`x-*`) to a schema. The typed `OpenAPISchema`
 * shape doesn't include arbitrary keys, so we go through `unknown` rather
 * than a direct cast to keep TS strict.
 */
function setExtension(
  schema: OpenAPISchema,
  key: `x-${string}`,
  value: unknown
): void {
  (schema as unknown as Record<string, unknown>)[key] = value;
}
