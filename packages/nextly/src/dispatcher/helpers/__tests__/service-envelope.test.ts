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
  throw new Error("unwrapServiceResult did not throw for a failed result");
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
