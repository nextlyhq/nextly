/**
 * Reusable response-envelope schemas for OpenAPI.
 *
 * Mirrors the eight canonical response shapes in
 * `packages/nextly/src/api/response-shapes.ts`. Two builders:
 *
 *   - `buildEnvelopeComponents()`: schemas emitted regardless of which
 *     collections are present. PaginationMeta, CountResponse, and the
 *     two bulk-error variants.
 *   - `buildCollectionEnvelopes(schemaNames)`: name-mangled per-
 *     collection envelopes (`ListResponse<Slug>`, `MutationResponse<Slug>`,
 *     `BulkResponse<Slug>`). Generic via name mangling rather than OAS 3.1
 *     `allOf`-generics because most downstream tooling (including
 *     Scalar's Try-It panel) renders the mangled names better.
 *
 * @module nextly/openapi/mapping/envelopes
 */

import type { OpenAPISchema } from "../types";

export interface EnvelopeBundle {
  schemas: Record<string, OpenAPISchema>;
}

/**
 * Always-emitted shared envelopes. Independent of which collections exist.
 */
export function buildEnvelopeComponents(): EnvelopeBundle {
  const PaginationMeta: OpenAPISchema = {
    type: "object",
    required: ["total", "page", "limit", "totalPages", "hasNext", "hasPrev"],
    properties: {
      total: { type: "integer", minimum: 0 },
      page: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1, maximum: 50000 },
      totalPages: { type: "integer", minimum: 0 },
      hasNext: { type: "boolean" },
      hasPrev: { type: "boolean" },
    },
    description:
      "Pagination metadata returned with every list response. Page is 1-indexed; " +
      "limit caps at 50000.",
  };

  const CountResponse: OpenAPISchema = {
    type: "object",
    required: ["total"],
    properties: { total: { type: "integer", minimum: 0 } },
    description: "Returned by `GET /api/{collection}/count`.",
  };

  // Delete returns `{ message, item: { id } }` — only the id, not the full
  // document body. Reused across all collections (no name mangling needed).
  const DeleteResponse: OpenAPISchema = {
    type: "object",
    required: ["message", "item"],
    properties: {
      message: { type: "string" },
      item: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
    description: "Returned by `DELETE /api/{collection}/{id}`.",
  };

  // Per-item error for id-keyed bulk ops (delete-by-ids, update-by-ids).
  // Mirrors `PerItemError` in api/response-shapes.ts:132.
  const BulkItemError: OpenAPISchema = {
    type: "object",
    required: ["id", "code", "message"],
    properties: {
      id: {
        type: "string",
        description: "Identifier echoed from the request.",
      },
      code: { type: "string", description: "Canonical NextlyErrorCode value." },
      message: {
        type: "string",
        description:
          "Public-safe explanation. Generic per code; no identifier echo, " +
          "no value leaking.",
      },
    },
  };

  // Per-item error for positional bulk uploads (no pre-assigned id).
  // Mirrors `BulkUploadError` in api/response-shapes.ts:141.
  const BulkUploadItemError: OpenAPISchema = {
    type: "object",
    required: ["index", "filename", "code", "message"],
    properties: {
      index: {
        type: "integer",
        minimum: 0,
        description: "Positional index in the original request payload.",
      },
      filename: {
        type: "string",
        description:
          "Filename from the input. UX context only, not an identifier.",
      },
      code: { type: "string", description: "Canonical NextlyErrorCode value." },
      message: { type: "string", description: "Public-safe explanation." },
    },
  };

  return {
    schemas: {
      PaginationMeta,
      CountResponse,
      DeleteResponse,
      BulkItemError,
      BulkUploadItemError,
    },
  };
}

function makeMutationResponse(name: string): OpenAPISchema {
  return {
    type: "object",
    required: ["message", "item"],
    properties: {
      message: { type: "string" },
      item: { $ref: `#/components/schemas/${name}` },
    },
  };
}

function makeListResponse(name: string): OpenAPISchema {
  return {
    type: "object",
    required: ["items", "meta"],
    properties: {
      items: {
        type: "array",
        items: { $ref: `#/components/schemas/${name}` },
      },
      meta: { $ref: "#/components/schemas/PaginationMeta" },
    },
  };
}

function makeBulkResponse(name: string): OpenAPISchema {
  return {
    type: "object",
    required: ["message", "items", "errors"],
    properties: {
      message: { type: "string" },
      items: {
        type: "array",
        items: { $ref: `#/components/schemas/${name}` },
      },
      errors: {
        type: "array",
        items: { $ref: "#/components/schemas/BulkItemError" },
      },
    },
  };
}

/**
 * Per-collection envelopes: emits `ListResponse<Name>`, `MutationResponse<Name>`,
 * `BulkResponse<Name>` for each provided schema name. The `<Name>` must already
 * be registered as a `components/schemas` entry (the collection-schema deriver
 * and collection routes take care of that).
 */
export function buildCollectionEnvelopes(
  schemaNames: readonly string[]
): EnvelopeBundle {
  const schemas: Record<string, OpenAPISchema> = {};
  for (const name of schemaNames) {
    schemas[`ListResponse${name}`] = makeListResponse(name);
    schemas[`MutationResponse${name}`] = makeMutationResponse(name);
    schemas[`BulkResponse${name}`] = makeBulkResponse(name);
  }
  return { schemas };
}

/**
 * Per-single envelopes: emits ONLY `MutationResponse<Name>` per provided
 * name. Singles have no list / count / bulk variants (there's exactly one
 * document per Single), so we don't generate `ListResponse<Name>` or
 * `BulkResponse<Name>` — those would be dead weight in the spec.
 */
export function buildSingleEnvelopes(
  schemaNames: readonly string[]
): EnvelopeBundle {
  const schemas: Record<string, OpenAPISchema> = {};
  for (const name of schemaNames) {
    schemas[`MutationResponse${name}`] = makeMutationResponse(name);
  }
  return { schemas };
}
