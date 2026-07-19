// Typed error codes returned by applyDesiredSchema.
// Each failure must classify into one of these; INTERNAL_ERROR is the
// last-resort fallback for unmapped throws.
//
// Adding a new code is a deliberate act — it widens the public surface
// and downstream callers that exhaustively switch on the union must
// handle the new case. Removing one is a SemVer-breaking change.

import { UnsupportedDialectVersionError } from "@nextlyhq/adapter-drizzle/version-check";

export type SchemaApplyErrorCode =
  | "SCHEMA_VERSION_CONFLICT"
  | "PUSHSCHEMA_FAILED"
  | "DDL_EXECUTION_FAILED"
  | "CONFIRMATION_DECLINED"
  | "CONFIRMATION_REQUIRED_NO_TTY"
  | "CONNECTION_FAILED"
  | "UNSUPPORTED_DIALECT_VERSION"
  | "INTERNAL_ERROR";

export interface ClassifiedError {
  code: SchemaApplyErrorCode;
  message: string;
  details?: unknown;
}

// Translates an unknown thrown value into one of the typed codes.
// Used by the apply pipeline to convert exceptions into the discriminated
// failure branch of ApplyResult.
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof UnsupportedDialectVersionError) {
    return {
      code: "UNSUPPORTED_DIALECT_VERSION",
      message: err.message,
      details: err,
    };
  }

  if (err instanceof Error) {
    // drizzle-kit v1's programmatic entrypoints still throw plain Error
    // objects with no typed hierarchy (verified: resolver crashes and
    // client failures alike), so the stack trace remains the signal —
    // its frames contain the drizzle-kit payload-* module paths.
    // (drizzle-orm QUERY errors, by contrast, are typed DrizzleQueryError
    // in v1 and carry the driver error on `.cause`; those surface through
    // the executor as DDL_EXECUTION_FAILED, not here.)
    const stack = err.stack ?? "";
    if (stack.includes("drizzle-kit")) {
      return {
        code: "PUSHSCHEMA_FAILED",
        message: err.message,
        details: err,
      };
    }
    return {
      code: "INTERNAL_ERROR",
      message: err.message,
      details: err,
    };
  }

  // Non-Error throws (strings, plain objects, etc.) — coerce to string.
  const message = typeof err === "string" ? err : JSON.stringify(err);
  return {
    code: "INTERNAL_ERROR",
    message,
    details: err,
  };
}
