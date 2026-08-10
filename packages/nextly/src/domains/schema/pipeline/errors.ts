// Typed error codes returned by applyDesiredSchema.
// Each failure must classify into one of these; INTERNAL_ERROR is the
// last-resort fallback for unmapped throws.
//
// Adding a new code is a deliberate act — it widens the public surface
// and downstream callers that exhaustively switch on the union must
// handle the new case. Removing one is a SemVer-breaking change.

import { UnsupportedDialectVersionError } from "@nextlyhq/adapter-drizzle/version-check";

import { NextlyError } from "../../../errors";

export type SchemaApplyErrorCode =
  | "SCHEMA_VERSION_CONFLICT"
  | "PUSHSCHEMA_FAILED"
  | "DDL_EXECUTION_FAILED"
  // The apply declined to start, because the database's CONTENTS could not survive it. Distinct
  // from DDL_EXECUTION_FAILED in the fact that matters most to whoever reads it: nothing ran, so
  // the schema is exactly as it was. Its `details` carry which column and what to do about it.
  | "PRECONDITION_FAILED"
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
/**
 * How a refused precondition is presented, wherever a failure is built from one.
 *
 * There are two places that turn a thrown value into a returned failure — `classifyError` here, and
 * `PushSchemaPipeline`'s own catch, which constructs its result directly rather than calling this
 * module. They classify DIFFERENT error families on purpose (the pipeline knows its own typed errors;
 * this one reads drizzle-kit stack frames), so they are not merged. What they must not do is disagree
 * about how THIS answer reads, which is why the presentation lives here and both ask for it.
 */
export function describePrecondition(err: NextlyError): {
  message: string;
  details: unknown;
} {
  return { message: preconditionMessage(err), details: err.publicData };
}

/**
 * The operator-facing text for a refused precondition.
 *
 * Reads the per-error messages the refusal carried and falls back to the generic public message
 * only when there are none, so a payload shape this does not recognise degrades to today's
 * behaviour rather than to an empty string.
 */
function preconditionMessage(err: NextlyError): string {
  const data: unknown = err.publicData;
  if (data && typeof data === "object" && "errors" in data) {
    const { errors } = data;
    if (Array.isArray(errors)) {
      const texts = errors
        .map(e =>
          e && typeof e === "object" && "message" in e ? e.message : undefined
        )
        .filter((m): m is string => typeof m === "string" && m.length > 0);
      if (texts.length > 0) return texts.join(" ");
    }
  }
  return err.message;
}

export function classifyError(err: unknown): ClassifiedError {
  // Checked before the generic Error branch: a refused precondition IS a NextlyError, and the
  // generic branch would flatten it to its public message and lose the payload naming the column.
  if (NextlyError.isValidation(err)) {
    return { code: "PRECONDITION_FAILED", ...describePrecondition(err) };
  }

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
