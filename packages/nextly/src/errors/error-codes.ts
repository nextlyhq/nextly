/**
 * Canonical NextlyError codes and their HTTP status mappings.
 *
 * Plugin codes outside this enum must always pass an explicit `statusCode`
 * to the NextlyError constructor (no enum lookup happens for unknown codes).
 */
export const NEXTLY_ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  INVALID_INPUT: 400,
  AUTH_REQUIRED: 401,
  AUTH_INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE: 409,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL_ERROR: 500,
  DATABASE_ERROR: 500,
  EXTERNAL_SERVICE_ERROR: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type NextlyErrorCode = keyof typeof NEXTLY_ERROR_STATUS;
