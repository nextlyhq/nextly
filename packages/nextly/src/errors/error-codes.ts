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
  // 422: understood, well-formed, and refused on a rule the caller can act on.
  // Deliberately NOT added to CANONICAL_CODE_FOR_STATUS -- that list drives the
  // status -> code direction, where 422 stays mapped to INVALID_INPUT.
  BUSINESS_RULE_VIOLATION: 422,
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
  // A stored object exceeded the cap a READ was given, which is a different
  // question from SIZE_EXCEEDED above: that one refuses an upload the caller
  // is sending, this one refuses to buffer an object already stored. Kept
  // apart so a caller discriminating on the code cannot match both.
  STORAGE_READ_TOO_LARGE: 413,
  // The store answered, and answered badly. 502 rather than 500 because the
  // fault is UPSTREAM of this process: a caller can retry it, and an operator
  // reading the log needs to look at the bucket rather than at this service.
  STORAGE_READ_UNREACHABLE: 502,
  MAGIC_BYTE_MISMATCH: 400,
  SVG_SANITIZATION_FAILED: 400,
  UNSUPPORTED_FOR_BACKEND: 415,
  // Plan B — schema bookkeeping consolidation.
  NEXTLY_LEGACY_BOOKKEEPING_DETECTED: 409,
  NEXTLY_UPGRADE_TABLE_NAME_COLLISION: 409,
  NEXTLY_UPGRADE_IN_PROGRESS: 409,
  // Plan C2 — nextly migrate phases.
  NEXTLY_MIGRATE_LOCK_BUSY: 409,
  NEXTLY_BASELINE_LOCK_NOT_HELD: 409,
  NEXTLY_RESOLVE_LOCK_NOT_HELD: 409,
  // Boot refused to serve: the migrate lock stayed held past the wait deadline,
  // so this process never established whether the schema matches the code. 503
  // rather than 409 — a load balancer should take the instance out of rotation
  // and retry it, which is exactly the recovery this refusal wants.
  NEXTLY_BOOT_MIGRATIONS_NOT_RUN: 503,
  // Still running rather than refused. 503 for the same reason: retry shortly.
  NEXTLY_BOOT_MIGRATIONS_PENDING: 503,
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
  // Plugin platform — a declared admin.clientConfig that cannot be delivered
  // to the browser, refused at boot rather than serialized mangled.
  NEXTLY_PLUGIN_CLIENT_CONFIG_INVALID: 500,
  // Plugin platform — a contributed admin widget that cannot be delivered to
  // the browser. Refused at boot because it is serialized into the ONE
  // `/api/admin-meta/workspace` payload: a value `JSON.stringify` throws on
  // fails that request for every admin, not just the widget's own card.
  NEXTLY_PLUGIN_ADMIN_WIDGET_INVALID: 500,
  // Plugin platform (P0) — boot-time plugin dependency/version resolution.
  PLUGIN_RESOLUTION_ERROR: 500,
  // Plugin platform (P4) — contributes.routes collection (D25).
  NEXTLY_ROUTE_COLLISION: 409,
  NEXTLY_ROUTE_INVALID_PATH: 400,
  // An email transport whose library is an optional peer dependency the host
  // has not installed. 503 rather than 500: the request is not malformed and
  // nothing is broken, the install simply cannot carry it out yet, and the
  // remedy is one command on the server rather than a change by the caller.
  NEXTLY_EMAIL_TRANSPORT_UNAVAILABLE: 503,
  // The tooling that compiles `nextly.config.ts` is an optional peer the host
  // has not installed. 503 rather than 500 for the same reason as the mail
  // transport above: nothing is broken and the request is not malformed, the
  // install simply cannot carry it out until one command is run.
  NEXTLY_CONFIG_TOOLING_UNAVAILABLE: 503,
} as const;

export type NextlyErrorCode = keyof typeof NEXTLY_ERROR_STATUS;

/**
 * The codes that REPRESENT their status, when a failure names none.
 *
 * A service that returns `{ success: false, statusCode }` without a code leaves
 * every boundary to infer one, and three boundaries inferring separately is how
 * the same 401 became `AUTH_REQUIRED` through the Direct API and
 * `INTERNAL_ERROR` through the REST dispatcher. This list is the ONE inference,
 * so they cannot disagree.
 *
 * Listed as CODES, not as status numbers: the number for each comes from
 * {@link NEXTLY_ERROR_STATUS} below, so a code whose canonical status changes
 * carries its inference with it instead of leaving a stale literal here.
 *
 * Several codes share a status -- 409 is both `CONFLICT` and `DUPLICATE`, 400
 * is both `VALIDATION_ERROR` and `INVALID_INPUT` -- so this is a choice, not a
 * mechanical inversion. Each entry is the reading that is still safe if the
 * other was meant: `CONFLICT` says "reload", which is unhelpful for a name
 * clash, while `DUPLICATE` would say "already exists", which is WRONG for a
 * stale write. A producer that knows which it means sets `code` and is
 * believed, and this list is never consulted for it.
 */
const CANONICAL_CODE_FOR_STATUS = [
  "VALIDATION_ERROR",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "RATE_LIMITED",
  "EXTERNAL_SERVICE_ERROR",
  "SERVICE_UNAVAILABLE",
] as const satisfies readonly NextlyErrorCode[];

/**
 * 422, which no canonical code claims.
 *
 * `INVALID_INPUT` answers 400 in this system, so it cannot supply this key the
 * way the codes above supply theirs. Legacy envelopes nonetheless use 422 for
 * "understood but unprocessable", and reading it as an internal error would
 * report the caller's own mistake as a server fault. Named rather than inlined
 * so it is visibly the one entry that is NOT derived.
 */
const LEGACY_UNPROCESSABLE_STATUS = 422;

const STATUS_TO_CODE: Readonly<Record<number, NextlyErrorCode>> = {
  ...Object.fromEntries(
    CANONICAL_CODE_FOR_STATUS.map(code => [NEXTLY_ERROR_STATUS[code], code])
  ),
  [LEGACY_UNPROCESSABLE_STATUS]: "INVALID_INPUT",
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

/**
 * The canonical error code a service names when it knows which one it means.
 *
 * A status is coarser than a code -- 409 covers both a name clash and a stale
 * write, and they need opposite advice -- so a failure that knows the
 * difference says so, and the boundary believes it instead of inferring the
 * safer reading from the number alone.
 *
 * Widened to `string` rather than `NextlyErrorCode`: a plugin declares codes
 * outside the canonical set, and the converter already carries those through.
 */
export type ServiceErrorCode = string;
