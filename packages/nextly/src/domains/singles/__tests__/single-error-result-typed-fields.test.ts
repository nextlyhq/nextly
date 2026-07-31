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

    // The reason travels with the issue: a boundary normalising this array
    // would otherwise have to invent one, and REQUIRED would reach the client
    // as a generic INVALID.
    expect(result.errors).toEqual([
      { field: "title", code: "REQUIRED", message: "Required." },
    ]);
    expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("leaves the typed fields absent for an untyped error", () => {
    const result = buildSingleErrorResult(new Error("boom"), "Failed");
    expect(result.code).toBeUndefined();
  });
});

describe("the Single boundaries rebuild the error rather than its status", () => {
  it("keeps a rate limit through the Direct API boundary", async () => {
    // Reconstructing from status alone dropped `publicData`, so the caller got
    // a 429 with no interval -- told to slow down without being told by how
    // much.
    const { createErrorFromSingleResult } = await import(
      "../../../direct-api/namespaces/helpers"
    );
    const result = buildSingleErrorResult(
      NextlyError.rateLimited({ retryAfterSeconds: 30 }),
      "Failed"
    );

    const err = createErrorFromSingleResult({
      success: false,
      statusCode: result.statusCode,
      code: result.code,
      message: result.message,
      publicData: result.publicData,
    });

    expect(err.code).toBe("RATE_LIMITED");
    expect(err.statusCode).toBe(429);
    expect(err.publicData).toEqual({ retryAfterSeconds: 30 });
  });

  it("still guesses from the status when no code was recorded", async () => {
    // The mirror: envelopes built by hand carry no code and must keep the
    // status-derived guess this boundary has always made.
    const { createErrorFromSingleResult } = await import(
      "../../../direct-api/namespaces/helpers"
    );
    const err = createErrorFromSingleResult({
      success: false,
      statusCode: 404,
      message: "Not found.",
    });
    expect(err.code).toBe("NOT_FOUND");
  });
});
