import type { z } from "zod";

import { NextlyError } from "../errors/nextly-error";

/**
 * Convert a `ZodError` into a `NextlyError.validation` call.
 *
 * Each Zod issue maps to one entry in `data.errors[]`:
 *   - `path`: dotted/bracketed path (`"user.email"`, `"items.2.quantity"`)
 *   - `code`: the Zod issue code (e.g. `"too_small"`, `"invalid_string"`),
 *     forwarded so admin clients can branch on machine-readable reasons.
 *   - `message`: the human-readable Zod message.
 *
 * The full `issues` array is preserved in `logContext.zodIssues` so operators
 * can triage from the raw payload.
 */
export function nextlyValidationFromZod(err: z.ZodError): NextlyError {
  return NextlyError.validation({
    errors: err.issues.map(issue => ({
      path: issue.path.join("."),
      code: issue.code,
      message: issue.message,
    })),
    logContext: { zodIssues: err.issues },
  });
}
