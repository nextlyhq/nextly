/**
 * OpenAPI error schemas generated from the live error-code enum.
 *
 * Every error code and status mapping is derived from `NEXTLY_ERROR_STATUS`
 * (the canonical core enum, via the plugin-sdk) by iteration — never
 * hand-listed — so a new core code appears in the spec with no edit here, and a
 * dropped code is caught by a test asserting the full enum is represented.
 *
 * @module components/errors
 * @since alpha
 */
import {
  NEXTLY_ERROR_STATUS,
  type NextlyErrorCode,
} from "@nextlyhq/plugin-sdk";

/** A loose JSON object — the shape OpenAPI schemas take when serialized. */
export type OpenApiSchema = Record<string, unknown>;

/** One OpenAPI response object, keyed by HTTP status string at use sites. */
export interface OpenApiResponse {
  description: string;
  /** Response-level headers (`x-request-id` always, `retry-after` on 429). */
  headers?: Record<string, { schema: OpenApiSchema; description: string }>;
  content?: Record<string, { schema: OpenApiSchema }>;
}

/** The generated error component + per-status responses. */
export interface ErrorComponents {
  /** `components.schemas.ErrorResponse` — the canonical `{ error: {...} }` body. */
  errorResponseSchema: OpenApiSchema;
  /** `components.responses.<status>` — one entry per status the enum defines. */
  responsesByStatus: Record<string, OpenApiResponse>;
}

/**
 * Build the error schemas and status-grouped responses from the live enum.
 */
export function buildErrorComponents(): ErrorComponents {
  const codes = Object.keys(NEXTLY_ERROR_STATUS) as NextlyErrorCode[];

  // Group codes by HTTP status so each response entry carries exactly the codes
  // that status can produce.
  const codesByStatus = new Map<number, NextlyErrorCode[]>();
  for (const code of codes) {
    const status = NEXTLY_ERROR_STATUS[code];
    const bucket = codesByStatus.get(status);
    if (bucket) bucket.push(code);
    else codesByStatus.set(status, [code]);
  }

  const errorResponseSchema: OpenApiSchema = {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "requestId"],
        properties: {
          // The full live enum — the single property that MUST stay generated.
          code: { enum: codes },
          message: { type: "string" },
          requestId: { type: "string" },
          data: { type: "object", additionalProperties: true },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };

  const responsesByStatus: Record<string, OpenApiResponse> = {};
  for (const [status, statusCodes] of codesByStatus) {
    // Every response carries `x-request-id` (correlation, always emitted); 429
    // additionally documents `retry-after`.
    const headers: Record<
      string,
      { schema: OpenApiSchema; description: string }
    > = {
      "x-request-id": {
        schema: { type: "string" },
        description:
          "Correlation id for this request (also in the error body).",
      },
    };
    if (status === 429) {
      headers["retry-after"] = {
        schema: { type: "integer" },
        description: "Seconds to wait before retrying (RATE_LIMITED).",
      };
    }
    responsesByStatus[String(status)] = {
      description: `Error response (${statusCodes.join(", ")}).`,
      headers,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ErrorResponse" },
        },
      },
    };
  }

  return { errorResponseSchema, responsesByStatus };
}
