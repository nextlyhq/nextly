/**
 * The canonical response envelopes (`api/response-shapes.ts` in core) as
 * reusable OpenAPI components, plus the operation-level success-response
 * builder. Every mutation answers `{message, item, warnings?}`, every list
 * answers `{items, meta}` — one schema each, referenced by every operation,
 * so the spec teaches the API's actual shape instead of leaving responses
 * undocumented.
 *
 * @module components/envelopes
 * @since alpha
 */
import type { OpenApiSchema } from "./errors";

/** Which canonical envelope an operation's success response uses. */
export type EnvelopeKind =
  | "list" // {items, meta}
  | "doc" // the bare document
  | "mutation" // {message, item, warnings?}
  | "action" // {message, ...}
  | "data" // a named-field object surface
  | "total" // {total}
  | "bulk"; // {message, items, errors, warnings?}

const paginationMeta: OpenApiSchema = {
  type: "object",
  required: ["total", "page", "limit", "totalPages", "hasNext", "hasPrev"],
  properties: {
    total: { type: "integer" },
    page: { type: "integer" },
    limit: { type: "integer" },
    totalPages: { type: "integer" },
    hasNext: { type: "boolean" },
    hasPrev: { type: "boolean" },
  },
  additionalProperties: false,
};

const warnings: OpenApiSchema = {
  type: "array",
  items: { type: "string" },
  description: "Non-fatal notices (e.g. side-effect fallbacks).",
};

/** `components.schemas` entries every operation shares. */
export function buildEnvelopeSchemas(): Record<string, OpenApiSchema> {
  return {
    PaginationMeta: paginationMeta,
    ListResponse: {
      type: "object",
      required: ["items", "meta"],
      properties: {
        // Item shape is surface-specific (a collection entry, a role, …); the
        // envelope itself is the contract being documented here.
        items: { type: "array", items: { type: "object" } },
        meta: { $ref: "#/components/schemas/PaginationMeta" },
      },
      additionalProperties: false,
    },
    MutationResponse: {
      type: "object",
      // `item` is required: core's respondMutation(message, item) takes the
      // mutated document as a mandatory argument, so every mutation body
      // carries it.
      required: ["message", "item"],
      properties: {
        message: { type: "string" },
        item: { type: "object" },
        warnings,
      },
      additionalProperties: false,
    },
    ActionResponse: {
      type: "object",
      required: ["message"],
      properties: {
        message: { type: "string" },
        warnings,
      },
      // Action results also carry named fields (id, result, …) which vary per
      // operation, so the envelope stays open there.
      additionalProperties: true,
    },
    DataResponse: {
      type: "object",
      description:
        "A named-field object body; fields vary per operation (see the operation description).",
      additionalProperties: true,
    },
    TotalResponse: {
      type: "object",
      required: ["total"],
      properties: { total: { type: "integer" } },
      additionalProperties: false,
    },
    BulkResponse: {
      type: "object",
      required: ["message", "items", "errors"],
      properties: {
        message: { type: "string" },
        items: { type: "array", items: { type: "object" } },
        errors: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, error: { type: "string" } },
          },
        },
        warnings,
      },
      additionalProperties: false,
    },
  };
}

/** A per-operation success response override (schema beyond the envelope). */
export interface SuccessResponseSpec {
  /** HTTP status of the success response (default 200). */
  status?: number;
  /** Replaces the envelope $ref with a surface-specific schema. */
  schema?: OpenApiSchema;
  description?: string;
}

/**
 * Build the success `responses` entry for an operation from its envelope kind.
 * Falls open (no entry) for unknown kinds — errors are always attached by the
 * generator separately.
 */
export function successResponse(
  envelope: EnvelopeKind | undefined,
  spec?: SuccessResponseSpec
): Record<string, unknown> | undefined {
  if (!envelope) return undefined;
  const refFor: Record<EnvelopeKind, string> = {
    list: "#/components/schemas/ListResponse",
    doc: "#/components/schemas/DataResponse",
    mutation: "#/components/schemas/MutationResponse",
    action: "#/components/schemas/ActionResponse",
    data: "#/components/schemas/DataResponse",
    total: "#/components/schemas/TotalResponse",
    bulk: "#/components/schemas/BulkResponse",
  };
  const schema = spec?.schema ?? { $ref: refFor[envelope] };
  const status = String(spec?.status ?? 200);
  return {
    [status]: {
      description:
        spec?.description ??
        (envelope === "doc" ? "The document." : "Success."),
      content: { "application/json": { schema } },
    },
  };
}

/** A generic JSON request body for write operations without a known schema. */
export function genericJsonRequest(): Record<string, unknown> {
  return {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          additionalProperties: true,
          description: "Request body; shape is surface-specific.",
        },
      },
    },
  };
}
