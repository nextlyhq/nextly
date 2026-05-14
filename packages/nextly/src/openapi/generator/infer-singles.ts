/**
 * Generator pipeline — `infer-singles` phase.
 *
 * Turns each collected `SingleConfig` into exactly two operations and the
 * supporting schemas:
 *
 *   - GET  /api/{slug}  -> bare `<Name>` schema (matches respondDoc)
 *   - PATCH /api/{slug} -> `MutationResponse<Name>`
 *
 * Singles have no list / count / findById / create / delete operations —
 * the runtime auto-initializes the document on first read, so there's no
 * 404, no create endpoint, and no bulk variants.
 *
 * Read accepts `populate` and `locale` query params (relationship expansion
 * + localization). Update has no query params; the body is the partial
 * `Update<Name>` schema.
 *
 * @module nextly/openapi/generator/infer-singles
 */

import type { SingleConfig } from "../../singles/config/types";
import type {
  OperationIR,
  ParameterIR,
  ResponseMapIR,
  SecurityRequirementIR,
} from "../ir/types";
import {
  deriveNestedItemSchemas,
  deriveSingleSchemas,
} from "../mapping/derive-schemas";
import { buildSingleEnvelopes } from "../mapping/envelopes";
import type { OpenAPISchema } from "../types";

export interface InferSinglesResult {
  operations: readonly OperationIR[];
  schemas: Readonly<Record<string, OpenAPISchema>>;
}

const STANDARD_SECURITY: readonly SecurityRequirementIR[] = [
  { bearerAuth: [] },
  { cookieAuth: [] },
  { apiKeyAuth: [] },
];

const COMMON_ERROR_RESPONSES: ResponseMapIR = {
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "429": { $ref: "#/components/responses/RateLimited" },
  "500": { $ref: "#/components/responses/InternalServerError" },
};

const POPULATE_PARAM: ParameterIR = {
  name: "populate",
  in: "query",
  required: false,
  schema: { type: "string" },
  description: "Comma-separated relationship fields to expand.",
};

const LOCALE_PARAM: ParameterIR = {
  name: "locale",
  in: "query",
  required: false,
  schema: { type: "string" },
  description: "Locale code (when localization is enabled).",
};

function makeReadSingleOp(
  slug: string,
  baseName: string,
  tag: string,
  path: string
): OperationIR {
  return {
    path,
    method: "GET",
    versions: ["1.0"],
    operationId: `${slug}.read`,
    tags: [tag],
    summary: `Read ${tag}`,
    parameters: [POPULATE_PARAM, LOCALE_PARAM],
    responses: {
      "200": {
        description: "Current document for this single.",
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${baseName}` },
          },
        },
      },
      ...COMMON_ERROR_RESPONSES,
    },
    security: STANDARD_SECURITY,
    extensions: {},
  };
}

function makeUpdateSingleOp(
  slug: string,
  baseName: string,
  tag: string,
  path: string
): OperationIR {
  return {
    path,
    method: "PATCH",
    versions: ["1.0"],
    operationId: `${slug}.update`,
    tags: [tag],
    summary: `Update ${tag}`,
    parameters: [],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/Update${baseName}` },
        },
      },
    },
    responses: {
      "200": {
        description: "Updated.",
        content: {
          "application/json": {
            schema: {
              $ref: `#/components/schemas/MutationResponse${baseName}`,
            },
          },
        },
      },
      "400": { $ref: "#/components/responses/ValidationError" },
      ...COMMON_ERROR_RESPONSES,
    },
    security: STANDARD_SECURITY,
    extensions: {},
  };
}

export function inferFromSingles(
  singles: readonly SingleConfig[]
): InferSinglesResult {
  const operations: OperationIR[] = [];
  const schemas: Record<string, OpenAPISchema> = {};
  const baseNames: string[] = [];

  for (const s of singles) {
    const derived = deriveSingleSchemas(s);
    Object.assign(schemas, derived.schemas);
    Object.assign(schemas, deriveNestedItemSchemas(s, derived.baseName));
    baseNames.push(derived.baseName);

    const tag = s.label?.singular ?? s.slug;
    const path = `/api/${s.slug}`;

    operations.push(
      makeReadSingleOp(s.slug, derived.baseName, tag, path),
      makeUpdateSingleOp(s.slug, derived.baseName, tag, path)
    );
  }

  Object.assign(schemas, buildSingleEnvelopes(baseNames).schemas);
  return { operations, schemas };
}
