/**
 * Reusable `Error` schema and named error responses for OpenAPI.
 *
 * The error-code enum is derived from `NEXTLY_ERROR_STATUS` at runtime, so
 * adding a new canonical error code in `errors/error-codes.ts` automatically
 * flows into the generated OpenAPI spec — no separate hand-mirrored list.
 *
 * @module nextly/openapi/mapping/errors
 */

import { NEXTLY_ERROR_STATUS } from "../../errors/error-codes";
import type { ResponseIR } from "../ir/types";
import type { OpenAPISchema } from "../types";

const ERROR_CODES: readonly string[] = Object.keys(NEXTLY_ERROR_STATUS);

export interface ErrorBundle {
  schemas: Record<string, OpenAPISchema>;
  responses: Record<string, ResponseIR>;
}

export function buildErrorComponents(): ErrorBundle {
  const Error: OpenAPISchema = {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: {
            type: "string",
            enum: [...ERROR_CODES],
            description: "Canonical NextlyErrorCode value.",
          },
          message: {
            type: "string",
            description: "Public-safe explanation, generic per code.",
          },
          messageKey: {
            type: "string",
            description:
              "i18n key for the message, when the server can resolve one.",
          },
          requestId: {
            type: "string",
            description:
              "Correlates with server logs. Echoed on every error response.",
          },
          data: {
            type: "object",
            additionalProperties: true,
            description: "Optional structured details. Schema varies per code.",
          },
        },
      },
    },
    description:
      "Canonical error envelope. Every 4xx / 5xx response uses this shape.",
  };

  const mkResponse = (description: string): ResponseIR => ({
    description,
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/Error" } },
    },
  });

  return {
    schemas: { Error },
    responses: {
      // 400-series
      ValidationError: mkResponse("Invalid input."),
      Unauthorized: mkResponse("Authentication required or token invalid."),
      Forbidden: mkResponse("Insufficient permission."),
      NotFound: mkResponse("Resource not found."),
      PayloadTooLarge: mkResponse("Request payload too large."),
      UnsupportedMediaType: mkResponse("Unsupported media type."),
      Conflict: mkResponse("Conflict with current state."),
      RateLimited: mkResponse("Too many requests."),
      // 500-series
      InternalServerError: mkResponse("Internal server error."),
      ServiceUnavailable: mkResponse("Service temporarily unavailable."),
    },
  };
}
