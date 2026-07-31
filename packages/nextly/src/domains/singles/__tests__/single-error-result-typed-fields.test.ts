// A Single's failure envelope carries the same typed fields a collection's does.
//
// The boundary rebuilds an error from the envelope's `code`. Recording only the
// status left a Single hook's `rateLimited()` taking the status fallback and
// reaching the caller as a generic 500, without the backoff a rate limit exists
// to communicate.

import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { errorFromServiceEnvelope } from "../../../errors/from-service-envelope";
import { buildSingleErrorResult } from "../services/single-utils";

describe("buildSingleErrorResult records the typed fields", () => {
  it("carries the code, status and public data of a rate limit", () => {
    const result = buildSingleErrorResult(
      NextlyError.rateLimited({ retryAfterSeconds: 30 }),
      "Failed to read single"
    );

    expect(result.code).toBe("RATE_LIMITED");
    expect(result.statusCode).toBe(429);
    expect(result.publicData).toEqual({ retryAfterSeconds: 30 });
  });

  it("round-trips through the boundary instead of becoming a 500", () => {
    // The half that matters to a caller: what the envelope records has to be
    // enough for the converter to rebuild the same error.
    const result = buildSingleErrorResult(
      NextlyError.authRequired(),
      "Failed to read single"
    );
    const rebuilt = errorFromServiceEnvelope(result);

    expect(rebuilt.code).toBe("AUTH_REQUIRED");
    expect(rebuilt.statusCode).toBe(401);
  });

  it("still carries per-field issues in the legacy field shape", () => {
    // The mirror: SingleResult's own `{field}` array predates the canonical
    // `{path}` one and its consumers still read it.
    const result = buildSingleErrorResult(
      NextlyError.validation({
        errors: [{ path: "title", code: "REQUIRED", message: "Required." }],
      }),
      "Failed to update single"
    );

    expect(result.errors).toEqual([{ field: "title", message: "Required." }]);
    expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("leaves the typed fields absent for an untyped error", () => {
    const result = buildSingleErrorResult(new Error("boom"), "Failed");
    expect(result.code).toBeUndefined();
  });
});
