// Typed error codes returned by applyDesiredSchema.
// Each failure must classify into one of these; INTERNAL_ERROR is the
// last-resort fallback for unmapped throws.
//
// Adding a new code is a deliberate act — it widens the public surface
// and downstream callers that exhaustively switch on the union must
// handle the new case. Removing one is a SemVer-breaking change.

import { UnsupportedDialectVersionError } from "@revnixhq/adapter-drizzle/version-check";

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
    // drizzle-kit's pushSchema throws plain Error objects whose stack frames
    // contain drizzle-kit/api.js. We use the stack trace as the signal because
    // drizzle-kit does not expose a typed error hierarchy.
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
