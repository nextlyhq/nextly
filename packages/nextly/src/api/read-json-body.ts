import { NextlyError } from "../errors";

/**
 * Parse `request.json()` and surface a structured validation error on
 * malformed bodies.
 *
 * Hoisted from ~14 inline copies across api routes (F17). The contract test
 * in Task 12 relies on a single canonical source of this validation, including
 * the `code: "invalid_json"` per-field code that admin/SDK consumers branch on.
 *
 * Generic over the parsed body type so callers can specify a narrower shape
 * without re-asserting at the call site (the function performs no runtime
 * validation beyond JSON-parseability).
 *
 * Accepts an optional `extraLogContext` so route-specific identifiers (e.g.
 * a single's slug) can be threaded into the operator log without resorting
 * to a route-local copy of the helper.
 */
export async function readJsonBody<T = unknown>(
  req: Request,
  extraLogContext?: Record<string, unknown>
): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage: "Validation failed.",
      publicData: {
        errors: [
          {
            path: "",
            code: "invalid_json",
            message: "Request body is not valid JSON.",
          },
        ],
      },
      logContext: { reason: "invalid-json-body", ...extraLogContext },
    });
  }
}
