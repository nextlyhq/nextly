/**
 * Tiny shared helpers for built-in module authors.
 *
 * Centralizes the three security schemes and the canonical error-response
 * map so each module file stays short. Modules that need to override
 * (e.g. `auth` uses `security: []` on public endpoints) just declare
 * their own local constants — these are conveniences, not policy.
 *
 * @module nextly/openapi/modules/_shared
 */

import type { SecurityRequirementIR } from "../ir/types";

export const STANDARD_SECURITY: readonly SecurityRequirementIR[] = [
  { bearerAuth: [] },
  { cookieAuth: [] },
  { apiKeyAuth: [] },
];

export const STANDARD_ERROR_RESPONSES = {
  "400": { $ref: "#/components/responses/ValidationError" },
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "429": { $ref: "#/components/responses/RateLimited" },
  "500": { $ref: "#/components/responses/InternalServerError" },
} as const;

export const NOT_FOUND_RESPONSE = {
  "404": { $ref: "#/components/responses/NotFound" },
} as const;

export const CONFLICT_RESPONSE = {
  "409": { $ref: "#/components/responses/Conflict" },
} as const;
