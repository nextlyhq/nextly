/**
 * Generator pipeline — `infer-collections` phase.
 *
 * Turns each collected `CollectionConfig` into the six standard CRUD
 * operations (list, count, findById, create, update, delete) plus the
 * supporting schemas:
 *
 *   - Three derived per-collection shapes: `<Name>`, `Create<Name>`, `Update<Name>`
 *   - Three per-collection envelopes: `ListResponse<Name>`, `MutationResponse<Name>`, `BulkResponse<Name>`
 *   - Nested-repeater item schemas: `<Name>__<Field>Item`
 *
 * Every operation declares the three security schemes (bearer / cookie /
 * api-key); per-operation access enforcement is a follow-up via
 * `x-nextly-access` annotations.
 *
 * @module nextly/openapi/generator/infer-collections
 */

import type { CollectionConfig } from "../../collections/config/define-collection";
import type {
  OperationIR,
  ParameterIR,
  ResponseMapIR,
  SecurityRequirementIR,
} from "../ir/types";
import {
  deriveCollectionSchemas,
  deriveNestedItemSchemas,
} from "../mapping/derive-schemas";
import { buildCollectionEnvelopes } from "../mapping/envelopes";
import type { OpenAPISchema } from "../types";

export interface InferCollectionsResult {
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

const ID_PATH_PARAM: ParameterIR = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "Document identifier.",
};

// ─── Query parameter helpers ──────────────────────────────────────────────

const queryParam = (
  name: string,
  schema: OpenAPISchema,
  description: string
): ParameterIR => ({
  name,
  in: "query",
  required: false,
  schema,
  description,
});

const LIMIT_PARAM = queryParam(
  "limit",
  { type: "integer", minimum: 1, maximum: 50000 },
  "Page size. Defaults to 10."
);
const OFFSET_PARAM = queryParam(
  "offset",
  { type: "integer", minimum: 0 },
  "Records to skip."
);
const SORT_PARAM = queryParam(
  "sort",
  { type: "string" },
  "Comma-separated field list. Prefix a field with `-` for DESC."
);
const WHERE_PARAM = queryParam(
  "where",
  { type: "string" },
  "URL-encoded JSON filter (supports equals/in/contains/gte/lte/...)."
);
const POPULATE_PARAM = queryParam(
  "populate",
  { type: "string" },
  "Comma-separated relationship fields to expand."
);
const SEARCH_PARAM = queryParam(
  "search",
  { type: "string" },
  "Full-text search query."
);
const LOCALE_PARAM = queryParam(
  "locale",
  { type: "string" },
  "Locale code (when localization is enabled)."
);

// ─── Per-verb operation builders ──────────────────────────────────────────

function makeListOp(
  slug: string,
  baseName: string,
  tag: string,
  basePath: string
): OperationIR {
  return {
    path: basePath,
    method: "GET",
    versions: ["1.0"],
    operationId: `${slug}.list`,
    tags: [tag],
    summary: `List ${tag}`,
    parameters: [
      LIMIT_PARAM,
      OFFSET_PARAM,
      SORT_PARAM,
      WHERE_PARAM,
      POPULATE_PARAM,
      SEARCH_PARAM,
      LOCALE_PARAM,
    ],
    responses: {
      "200": {
        description: "Paginated list.",
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/ListResponse${baseName}` },
          },
        },
      },
      ...COMMON_ERROR_RESPONSES,
    },
    security: STANDARD_SECURITY,
    extensions: {},
  };
}

function makeCountOp(
  slug: string,
  _baseName: string,
  tag: string,
  basePath: string
): OperationIR {
  return {
    path: `${basePath}/count`,
    method: "GET",
    versions: ["1.0"],
    operationId: `${slug}.count`,
    tags: [tag],
    summary: `Count matching ${tag}`,
    parameters: [WHERE_PARAM, SEARCH_PARAM, LOCALE_PARAM],
    responses: {
      "200": {
        description: "Count of matching documents.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CountResponse" },
          },
        },
      },
      ...COMMON_ERROR_RESPONSES,
    },
    security: STANDARD_SECURITY,
    extensions: {},
  };
}

function makeFindByIdOp(
  slug: string,
  baseName: string,
  tag: string,
  idPath: string
): OperationIR {
  return {
    path: idPath,
    method: "GET",
    versions: ["1.0"],
    operationId: `${slug}.findById`,
    tags: [tag],
    summary: `Get one ${tag}`,
    parameters: [ID_PATH_PARAM, POPULATE_PARAM, LOCALE_PARAM],
    responses: {
      "200": {
        description: "The requested document.",
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${baseName}` },
          },
        },
      },
      "404": { $ref: "#/components/responses/NotFound" },
      ...COMMON_ERROR_RESPONSES,
    },
    security: STANDARD_SECURITY,
    extensions: {},
  };
}

function makeCreateOp(
  slug: string,
  baseName: string,
  tag: string,
  basePath: string
): OperationIR {
  return {
    path: basePath,
    method: "POST",
    versions: ["1.0"],
    operationId: `${slug}.create`,
    tags: [tag],
    summary: `Create a ${tag}`,
    parameters: [],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/Create${baseName}` },
        },
      },
    },
    responses: {
      "201": {
        description: "Created.",
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

function makeUpdateOp(
  slug: string,
  baseName: string,
  tag: string,
  idPath: string
): OperationIR {
  return {
    path: idPath,
    method: "PATCH",
    versions: ["1.0"],
    operationId: `${slug}.update`,
    tags: [tag],
    summary: `Update a ${tag}`,
    parameters: [ID_PATH_PARAM],
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
      "404": { $ref: "#/components/responses/NotFound" },
      ...COMMON_ERROR_RESPONSES,
    },
    security: STANDARD_SECURITY,
    extensions: {},
  };
}

function makeDeleteOp(
  slug: string,
  _baseName: string,
  tag: string,
  idPath: string
): OperationIR {
  return {
    path: idPath,
    method: "DELETE",
    versions: ["1.0"],
    operationId: `${slug}.delete`,
    tags: [tag],
    summary: `Delete a ${tag}`,
    parameters: [ID_PATH_PARAM],
    responses: {
      "200": {
        description: "Deleted.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/DeleteResponse" },
          },
        },
      },
      "404": { $ref: "#/components/responses/NotFound" },
      ...COMMON_ERROR_RESPONSES,
    },
    security: STANDARD_SECURITY,
    extensions: {},
  };
}

// ─── Top-level entry ──────────────────────────────────────────────────────

export function inferFromCollections(
  collections: readonly CollectionConfig[]
): InferCollectionsResult {
  const operations: OperationIR[] = [];
  const schemas: Record<string, OpenAPISchema> = {};
  const baseNames: string[] = [];

  for (const c of collections) {
    const derived = deriveCollectionSchemas(c);
    Object.assign(schemas, derived.schemas);
    Object.assign(schemas, deriveNestedItemSchemas(c, derived.baseName));
    baseNames.push(derived.baseName);

    const tag = c.labels?.plural ?? c.slug;
    const basePath = `/api/${c.slug}`;
    const idPath = `${basePath}/{id}`;

    operations.push(
      makeListOp(c.slug, derived.baseName, tag, basePath),
      makeCountOp(c.slug, derived.baseName, tag, basePath),
      makeFindByIdOp(c.slug, derived.baseName, tag, idPath),
      makeCreateOp(c.slug, derived.baseName, tag, basePath),
      makeUpdateOp(c.slug, derived.baseName, tag, idPath),
      makeDeleteOp(c.slug, derived.baseName, tag, idPath)
    );
  }

  const envelopes = buildCollectionEnvelopes(baseNames);
  Object.assign(schemas, envelopes.schemas);

  return { operations, schemas };
}
