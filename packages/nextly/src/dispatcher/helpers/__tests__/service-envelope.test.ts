/**
 * `unwrapServiceResult` translates legacy `{ success, statusCode, message }`
 * service envelopes into thrown NextlyErrors. Status 409 is ambiguous on its
 * own: a unique-constraint duplicate and an optimistic-concurrency conflict
 * both surface as 409, but they need different codes and public messages
 * (DUPLICATE "Resource already exists." vs CONFLICT "The resource has
 * changed..."). The envelope's optional `code` disambiguates; these tests pin
 * that routing and the legacy-message logging contract.
 */
import { describe, it, expect } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { unwrapServiceResult } from "../service-envelope";

/** Grab the thrown NextlyError so assertions can inspect code/message. */
function unwrapError(
  result: Parameters<typeof unwrapServiceResult>[0],
  logContext?: Record<string, unknown>
): NextlyError {
  try {
    unwrapServiceResult(result, logContext);
  } catch (err) {
    if (NextlyError.is(err)) return err;
    throw err;
  }
  // Test sentinel; NextlyError because bare Error is disallowed package-wide.
  throw NextlyError.internal({
    logContext: {
      reason: "unwrapServiceResult did not throw for a failed result",
    },
  });
}

describe("unwrapServiceResult 409 disambiguation", () => {
  it("maps a DUPLICATE-coded 409 to NextlyError.duplicate", () => {
    const err = unwrapError({
      success: false,
      statusCode: 409,
      code: "DUPLICATE",
      message: "Resource already exists.",
    });

    expect(err.code).toBe("DUPLICATE");
    expect(err.statusCode).toBe(409);
    expect(err.publicMessage).toBe("Resource already exists.");
  });

  it("keeps the stale-version CONFLICT default for a code-less 409", () => {
    const err = unwrapError({
      success: false,
      statusCode: 409,
      message: "Version mismatch.",
    });

    expect(err.code).toBe("CONFLICT");
    expect(err.statusCode).toBe(409);
  });

  it("maps an explicitly CONFLICT-coded 409 to NextlyError.conflict", () => {
    const err = unwrapError({
      success: false,
      statusCode: 409,
      code: "CONFLICT",
      message: "The resource has changed.",
    });

    expect(err.code).toBe("CONFLICT");
  });

  it("keeps the legacy message and caller context in logContext", () => {
    const err = unwrapError(
      {
        success: false,
        statusCode: 409,
        code: "DUPLICATE",
        message: "Resource already exists.",
      },
      { collectionName: "test_page1" }
    );

    expect(err.logContext).toMatchObject({
      legacyMessage: "Resource already exists.",
      collectionName: "test_page1",
    });
  });
});

describe("unwrapServiceResult rebuilds from the canonical code", () => {
  // Status alone cannot identify these: three codes share 401, and 429/503
  // have no status branch at all, so every one of them reached the caller as a
  // generic 500 -- a rate limit indistinguishable from a crash.
  it.each([
    ["AUTH_REQUIRED", 401],
    ["AUTH_INVALID_CREDENTIALS", 401],
    ["TOKEN_EXPIRED", 401],
    ["RATE_LIMITED", 429],
    ["SERVICE_UNAVAILABLE", 503],
  ])("keeps %s and its status instead of collapsing to 500", (code, status) => {
    const err = unwrapError({
      success: false,
      statusCode: status,
      code,
      message: "service said no",
    });

    expect(err.code).toBe(code);
    expect(err.statusCode).toBe(status);
  });

  it("keeps a non-validation code carried on a 400", () => {
    // Every 400 was rebuilt as VALIDATION_ERROR whatever code it carried, so a
    // caller was told its data failed validation when it had not been
    // validated at all.
    const err = unwrapError({
      success: false,
      statusCode: 400,
      code: "INVALID_INPUT",
      message: "Depth must be between 0 and 5.",
    });

    expect(err.code).toBe("INVALID_INPUT");
    // The message round-trips, where the generic validation text replaced it.
    expect(err.publicMessage).toBe("Depth must be between 0 and 5.");
  });

  it("still gives the admin the per-field shape for a validation failure", () => {
    // The mirror. The admin maps `data.errors` onto form fields, so rebuilding
    // a validation failure through any other path silently breaks form errors.
    const err = unwrapError({
      success: false,
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Validation failed.",
      errors: [{ field: "title", message: "Title is required." }],
    });

    expect(err.code).toBe("VALIDATION_ERROR");
    expect((err.publicData as { errors: unknown[] }).errors).toEqual([
      { path: "title", code: "INVALID", message: "Title is required." },
    ]);
  });

  it("falls back to the status when the envelope carries no code", () => {
    // Envelopes are still built by hand in places, and those must behave
    // exactly as they did before.
    const err = unwrapError({ success: false, statusCode: 404 });
    expect(err.code).toBe("NOT_FOUND");
  });

  it("falls back to the status for a code it does not recognize", () => {
    // An unknown code must not throw its way out of the boundary; the status
    // is still a usable answer.
    const err = unwrapError({
      success: false,
      statusCode: 403,
      code: "SOMETHING_NEW",
    });
    expect(err.code).toBe("FORBIDDEN");
  });
});
