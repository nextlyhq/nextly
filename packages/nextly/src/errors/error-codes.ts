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
  // The schema builder is off in this environment (production by default).
  // Separate from FORBIDDEN: the caller's permissions are not the problem.
  BUILDER_DISABLED: 403,
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
  // Outbound-fetch safety (utils/validate-external-url): a URL refused for SSRF
  // safety, and a fetch that timed out / exceeded the size cap / failed to decode.
  EXTERNAL_URL_BLOCKED: 400,
  EXTERNAL_REQUEST_FAILED: 502,
  FILENAME_INVALID: 400,
  EXTENSION_BLOCKED: 400,
  MIME_BLOCKED: 415,
  MIME_NOT_ALLOWED: 415,
  SIZE_EXCEEDED: 413,
  MAGIC_BYTE_MISMATCH: 400,
  SVG_SANITIZATION_FAILED: 400,
  UNSUPPORTED_FOR_BACKEND: 415,
  // Plan B — schema bookkeeping consolidation.
  NEXTLY_LEGACY_BOOKKEEPING_DETECTED: 409,
  NEXTLY_UPGRADE_TABLE_NAME_COLLISION: 409,
  NEXTLY_UPGRADE_IN_PROGRESS: 409,
  // Plan C2 — nextly migrate phases.
  NEXTLY_MIGRATE_LOCK_BUSY: 409,
  NEXTLY_CORE_DESTRUCTIVE_REFUSED: 409,
  NEXTLY_MIGRATION_DRIFT: 409,
  NEXTLY_MIGRATION_APPLY_FAILED: 500,
  // Plan C3 — migrate:resolve recovery command.
  NEXTLY_MIGRATION_FILE_MISSING: 404,
  NEXTLY_MIGRATION_SNAPSHOT_MISSING: 404,
  NEXTLY_MIGRATION_RESOLVE_DRIFT: 409,
  NEXTLY_MIGRATION_RESOLVE_PRECONDITION: 409,
  // Plan D — UI schema support.
  NEXTLY_UI_SCHEMA_INVALID: 400,
  NEXTLY_SCHEMA_SLUG_COLLISION: 409,
  NEXTLY_SCHEMA_RELATION_TARGET_MISSING: 400,
  // Plugin platform (P2b) — schema extend (contributes.extend) + relations (D15).
  NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN: 400,
  NEXTLY_SCHEMA_EXTEND_FIELD_DUPLICATE: 409,
  NEXTLY_SCHEMA_CROSS_PLUGIN_RELATION: 409,
  // Plugin platform (P2c) — framework remap (.rename()).
  NEXTLY_SCHEMA_RENAME_UNKNOWN_TARGET: 400,
  // Plugin platform (P0) — boot-time plugin dependency/version resolution.
  PLUGIN_RESOLUTION_ERROR: 500,
  // Plugin platform (P4) — contributes.routes collection (D25).
  NEXTLY_ROUTE_COLLISION: 409,
  NEXTLY_ROUTE_INVALID_PATH: 400,
} as const;

export type NextlyErrorCode = keyof typeof NEXTLY_ERROR_STATUS;

/**
 * The code a status means when a failure names none.
 *
 * A service that returns `{ success: false, statusCode }` without a code
 * leaves every boundary to infer one, and three boundaries inferring
 * separately is how the same 401 became `AUTH_REQUIRED` through the Direct API
 * and `INTERNAL_ERROR` through the REST dispatcher. This is the ONE inference,
 * so they cannot disagree.
 *
 * It is a fallback, not a translation. A status is a coarser thing than a code
 * -- 409 covers both `DUPLICATE` and `CONFLICT`, 400 covers `VALIDATION_ERROR`
 * and `INVALID_INPUT` -- so a producer that knows which one it means must say
 * so by setting `code`, and this table is never consulted for it. The entries
 * below are the reading that is safe when nobody said: the one whose advice is
 * still true if the other was meant.
 */
const STATUS_TO_CODE: Readonly<Record<number, NextlyErrorCode>> = {
  400: "VALIDATION_ERROR",
  401: "AUTH_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  // Staleness rather than a name clash: "refresh and try again" is unhelpful
  // for a duplicate, while "already exists" would be WRONG for a stale write.
  // A producer that means the clash sets `code: "DUPLICATE"`.
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  422: "INVALID_INPUT",
  429: "RATE_LIMITED",
  502: "EXTERNAL_SERVICE_ERROR",
  503: "SERVICE_UNAVAILABLE",
};

/**
 * The canonical code for a status, for a failure that named none.
 *
 * Anything outside the table is an internal error: an unrecognised status from
 * a legacy envelope says nothing a caller can act on, and inventing a specific
 * code for it would assert a meaning no producer expressed.
 */
export function statusToErrorCode(statusCode: number): NextlyErrorCode {
  return STATUS_TO_CODE[statusCode] ?? "INTERNAL_ERROR";
}

/**
 * The sentence a caller reads for a code, when the failure supplied none.
 *
 * Kept beside the status table because they answer the same question together:
 * a code-less envelope's own `message` is NOT usable here. Those envelopes come
 * from legacy converters that store a raw exception's text, so promoting it
 * would put driver output, table names and internal paths on the wire -- the
 * disclosure the public error shape exists to prevent (spec 13.8).
 *
 * Every entry is generic by design. The specific detail stays in `logContext`
 * for the operator, against the same request id.
 */
const GENERIC_PUBLIC_MESSAGE: Readonly<
  Partial<Record<NextlyErrorCode, string>>
> = {
  VALIDATION_ERROR: "Validation failed.",
  INVALID_INPUT: "The request could not be processed.",
  AUTH_REQUIRED: "Authentication required.",
  FORBIDDEN: "You don't have permission to perform this action.",
  NOT_FOUND: "Not found.",
  CONFLICT:
    "The resource has changed since you last loaded it. Please refresh and try again.",
  DUPLICATE: "Resource already exists.",
  PAYLOAD_TOO_LARGE: "The request is too large.",
  UNSUPPORTED_MEDIA_TYPE: "That file type is not supported.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  EXTERNAL_SERVICE_ERROR: "An upstream service failed.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable.",
  INTERNAL_ERROR: "An unexpected error occurred.",
};

/** The generic sentence for a code; the internal one for anything unlisted. */
export function genericPublicMessage(code: string): string {
  return (
    GENERIC_PUBLIC_MESSAGE[code as NextlyErrorCode] ??
    GENERIC_PUBLIC_MESSAGE.INTERNAL_ERROR!
  );
}
