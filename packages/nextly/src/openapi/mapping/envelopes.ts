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
 * Spec: §8.2.
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
      BulkItemError,
      BulkUploadItemError,
    },
  };
}

/**
 * Per-collection envelopes: emits `ListResponse<Name>`, `MutationResponse<Name>`,
 * `BulkResponse<Name>` for each provided schema name. The `<Name>` must already
 * be registered as a `components/schemas` entry (T11/T13 take care of that).
 */
export function buildCollectionEnvelopes(
  schemaNames: readonly string[]
): EnvelopeBundle {
  const schemas: Record<string, OpenAPISchema> = {};
  for (const name of schemaNames) {
    schemas[`ListResponse${name}`] = {
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
    schemas[`MutationResponse${name}`] = {
      type: "object",
      required: ["message", "item"],
      properties: {
        message: { type: "string" },
        item: { $ref: `#/components/schemas/${name}` },
      },
    };
    schemas[`BulkResponse${name}`] = {
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
  return { schemas };
}
