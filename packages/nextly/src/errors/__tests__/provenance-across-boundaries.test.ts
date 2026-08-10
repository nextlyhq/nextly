/**
 * The thrown error reaches every boundary that rebuilds one, not just some.
 *
 * A service converts a failure into a public envelope and a boundary rebuilds
 * an error from it. The rebuilt error is correct for the caller and blind for
 * whoever debugs it, so the original rides along on the envelope. What decides
 * whether that survives is WHERE it is read: an argument each boundary passes
 * is an opt-in, and the boundaries that forgot were the REST dispatcher, the
 * singles route, the plugin-facing facade, both bulk-by-query paths and the
 * version writes.
 *
 * These assert the read happens in the converter, so a boundary is covered by
 * handing over the envelope it already hands over.
 */

import { describe, expect, it } from "vitest";

import { unwrapServiceResult } from "../../dispatcher/helpers/service-envelope";
import {
  createErrorFromResult,
  createErrorFromSingleResult,
} from "../../direct-api/namespaces/helpers";
import { buildSingleErrorResult } from "../../domains/singles/services/single-utils";
import { NEXTLY_ERROR_STATUS } from "../error-codes";
import {
  errorEnvelopeFields,
  errorFromServiceEnvelope,
} from "../from-service-envelope";
import { NextlyError } from "../nextly-error";
import { originalErrorOf } from "../original-error";

/** The failure a rebuild has nothing to say about and most needs to name. */
function driverFailure(): Error {
  return new Error("connection terminated unexpectedly");
}

/**
 * A failed envelope exactly as a service builds one, rather than a literal
 * carrying a hand-attached symbol. The point under test is that what the
 * PRODUCERS attach is what the CONSUMERS read, so a fixture that attaches it
 * itself would pass even if the two halves disagreed.
 */
function envelopeFrom(error: Error, statusCode: number) {
  return { success: false as const, statusCode, ...errorEnvelopeFields(error) };
}

describe("the converter reads provenance off the envelope", () => {
  it("chains it on the code-keyed branch", () => {
    const original = new NextlyError({
      code: "RATE_LIMITED",
      publicMessage: "Too many requests.",
      statusCode: 429,
      cause: driverFailure(),
    });

    const rebuilt = errorFromServiceEnvelope(envelopeFrom(original, 429));

    expect(rebuilt.cause).toBe(original);
  });

  it("chains it on the validation branch", () => {
    const original = NextlyError.validation({
      errors: [{ path: "title", code: "REQUIRED", message: "Required." }],
    });

    const rebuilt = errorFromServiceEnvelope(
      envelopeFrom(original, NEXTLY_ERROR_STATUS.VALIDATION_ERROR)
    );

    expect(rebuilt.code).toBe("VALIDATION_ERROR");
    expect(rebuilt.cause).toBe(original);
  });

  // The branches that carry the least information about the failure are the
  // ones whose cause is worth the most: a code-less envelope is what a raw
  // driver rejection produces, and each of these built its error from a
  // factory call that named only the log context.
  it.each([
    ["not found", NEXTLY_ERROR_STATUS.NOT_FOUND],
    ["forbidden", NEXTLY_ERROR_STATUS.FORBIDDEN],
    ["conflict", NEXTLY_ERROR_STATUS.CONFLICT],
    ["validation", NEXTLY_ERROR_STATUS.VALIDATION_ERROR],
    ["internal", NEXTLY_ERROR_STATUS.INTERNAL_ERROR],
  ])("chains it on the code-less %s branch", (_label, statusCode) => {
    const original = driverFailure();

    const rebuilt = errorFromServiceEnvelope(
      envelopeFrom(original, statusCode)
    );

    expect(rebuilt.code).not.toBe("RATE_LIMITED");
    expect(rebuilt.cause).toBe(original);
  });

  it("prefers an explicit cause over the envelope's own", () => {
    // The argument stays for the caller that holds the error but has no
    // envelope carrying it; where both exist the caller is the more specific
    // of the two and must not be silently overridden.
    const carried = driverFailure();
    const explicit = new Error("the one the caller actually holds");

    const rebuilt = errorFromServiceEnvelope(
      envelopeFrom(carried, NEXTLY_ERROR_STATUS.INTERNAL_ERROR),
      {},
      explicit
    );

    expect(rebuilt.cause).toBe(explicit);
  });

  it("leaves cause undefined when the envelope carries nothing", () => {
    // The control. Without it every assertion above would still pass if the
    // converter attached some fallback error of its own.
    const rebuilt = errorFromServiceEnvelope({
      success: false,
      statusCode: 500,
    } as never);

    expect(rebuilt.cause).toBeUndefined();
  });
});

describe("provenance survives the boundaries that rebuild", () => {
  it("survives the REST dispatcher", () => {
    const original = driverFailure();
    const result = envelopeFrom(original, 500);

    let thrown: unknown;
    try {
      unwrapServiceResult(result, { op: "update" });
    } catch (error) {
      thrown = error;
    }

    expect(NextlyError.is(thrown)).toBe(true);
    expect((thrown as NextlyError).cause).toBe(original);
  });

  it("survives the Direct API collection helper", () => {
    const original = driverFailure();
    // `message` and `data` after the spread rather than inside the fixture:
    // this boundary's own result shape requires both, and a raw rejection
    // contributes no envelope fields for either.
    const result = {
      ...envelopeFrom(original, 500),
      message: "Operation failed.",
      data: null,
    };

    expect(createErrorFromResult(result).cause).toBe(original);
  });

  it("survives the Direct API single helper", () => {
    const original = driverFailure();

    expect(createErrorFromSingleResult(envelopeFrom(original, 500)).cause).toBe(
      original
    );
  });

  it("survives a single service result built from a raw rejection", () => {
    // The full round trip through the producer the singles route reads: a raw
    // rejection has no typed field to lift, so the envelope it produces
    // carries nothing BUT the provenance — which is the case that was lost.
    const original = driverFailure();
    const result = buildSingleErrorResult(original, "Operation failed");

    expect(errorFromServiceEnvelope(result).cause).toBe(original);
  });
});

describe("the mechanism the spreading boundaries depend on", () => {
  it("keeps the carrier across a spread", () => {
    // The singles route and both Direct API helpers hand over
    // `{ ...result, ... }` rather than the result itself, so they are covered
    // only while the carrier is an ENUMERABLE own property — spread copies no
    // other kind. Asserted here so making it non-enumerable fails once, with a
    // reason, instead of quietly emptying `cause` at three boundaries.
    const original = driverFailure();
    const result = envelopeFrom(original, 500);

    expect(originalErrorOf({ ...result })).toBe(original);
  });

  it("keeps the carrier off the wire", () => {
    // Enumerable is the requirement above; serializable is what it must not
    // become. A symbol key is skipped by both `JSON.stringify` and
    // `Object.keys`, which is what lets the envelope carry a driver message
    // that §13.8 keeps out of a response body.
    const result = envelopeFrom(driverFailure(), 500);

    expect(JSON.stringify(result)).not.toContain("connection terminated");
    expect(Object.keys(result)).not.toContain("cause");
  });
});
