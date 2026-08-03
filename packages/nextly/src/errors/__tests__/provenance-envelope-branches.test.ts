/**
 * A branch that returns early is a branch that silently opts out.
 *
 * These cover the places that build a failure from a service envelope WITHOUT
 * going through the converter, or that return before reaching the helper that
 * attaches the thrown error. Each one answered correctly and named nothing, so
 * the failure they describe was the failure nobody could find.
 */

import { describe, expect, it } from "vitest";

import { errorEnvelopeFields } from "../from-service-envelope";
import { NextlyError } from "../nextly-error";
import { originalErrorOf } from "../original-error";

function driverFailure(): Error {
  return new Error("connection terminated unexpectedly");
}

describe("the factories that a status-derived rebuild reaches", () => {
  // The converter names `cause:` explicitly rather than spreading it in,
  // because an option a factory does not declare is a type error when written
  // out and accepted in silence when spread. These pin the declarations that
  // spelling depends on: without them the converter would still compile and
  // still drop the cause.
  it.each([
    ["notFound", () => NextlyError.notFound],
    ["forbidden", () => NextlyError.forbidden],
    ["conflict", () => NextlyError.conflict],
    ["internal", () => NextlyError.internal],
  ])("%s carries a cause", (_name, factory) => {
    const original = driverFailure();

    expect(factory()({ cause: original }).cause).toBe(original);
  });

  it("validation carries a cause alongside its errors", () => {
    // Separate because its options are not optional: it is the only one of the
    // five whose `errors` must be supplied, and a restore rejected by today's
    // rules reaches it holding the update failure underneath.
    const original = driverFailure();

    const error = NextlyError.validation({
      errors: [{ path: "versionNo", code: "RESTORE_REJECTED", message: "no" }],
      cause: original,
    });

    expect(error.cause).toBe(original);
    expect(error.code).toBe("VALIDATION_ERROR");
  });
});

describe("errorEnvelopeFields on the branches that used to return first", () => {
  it("carries a programmer error without lending it a code", () => {
    // A defect in our own code must not inherit a caller's 4xx fallback, so
    // this branch contributes no typed fields on purpose. That is the reason it
    // returned early, and the reason it left with nothing: the thrown error is
    // the only thing that names where the defect was.
    const thrown = new TypeError("cannot read properties of undefined");
    const fields = errorEnvelopeFields(thrown);

    expect(fields.code).toBeUndefined();
    expect(fields.statusCode).toBeUndefined();
    expect(originalErrorOf(fields)).toBe(thrown);
  });

  it("survives being spread into the result the branch returns", () => {
    // The branches build a literal and spread the helper into it, so this is
    // the shape the boundary actually receives.
    const thrown = driverFailure();
    const result = {
      success: false,
      statusCode: 500,
      message: "Failed to create collection",
      data: null,
      ...errorEnvelopeFields(thrown),
    };

    expect(originalErrorOf(result)).toBe(thrown);
    // Still not on the wire: the carrier is symbol-keyed.
    expect(JSON.stringify(result)).not.toContain("connection terminated");
  });
});
