/**
 * The error a public envelope was built from survives alongside it, and is
 * chained onto whatever the boundary rebuilds.
 *
 * A service strips `cause` and `logContext` on the way out because the result
 * shape is publicly surfaced, and the boundary then rebuilds from what
 * survived. Correct for the caller, useless for the operator: every unexpected
 * failure arrives looking identical, with the driver error and the thrower's
 * identifiers already gone.
 */

import { describe, expect, it } from "vitest";

import {
  errorFromServiceEnvelope,
  typedErrorEnvelopeFields,
} from "../from-service-envelope";
import { NextlyError } from "../nextly-error";
import {
  ORIGINAL_ERROR,
  originalErrorOf,
  withOriginalError,
} from "../original-error";

describe("carrying the original error on a public envelope", () => {
  const original = NextlyError.internal({
    cause: new Error("driver: duplicate key on users_email_idx"),
    logContext: { userId: "u-42", table: "users" },
  });

  it("survives the spread the services build their results with", () => {
    // The load-bearing property. Every producer writes
    // `{ ...errorToServiceResult(...) }`, and spread copies only ENUMERABLE
    // own properties — a non-enumerable symbol would be dropped at exactly
    // the call sites this exists for, silently.
    const envelope = withOriginalError({ success: false as const }, original);
    const spread = { ...envelope };

    expect(originalErrorOf(spread)).toBe(original);
  });

  it("cannot reach a response body", () => {
    const envelope = withOriginalError(
      { success: false as const, message: "It failed." },
      original
    );

    // Symbols are invisible to both, which is what makes this safe to attach
    // to a shape that gets serialised to a caller.
    expect(JSON.stringify(envelope)).not.toContain("users_email_idx");
    expect(JSON.stringify(envelope)).not.toContain("u-42");
    expect(Object.keys(envelope)).toEqual(["success", "message"]);
  });

  it("is absent from an envelope nothing attached one to", () => {
    expect(originalErrorOf({ success: false })).toBeUndefined();
    expect(originalErrorOf(null)).toBeUndefined();
    expect(originalErrorOf("not an object")).toBeUndefined();
  });

  it("cannot be overwritten once attached", () => {
    // The provenance is the point: a later writer replacing it would make the
    // chained cause describe a different failure than the envelope.
    const envelope = withOriginalError({ success: false as const }, original);

    expect(() => {
      Object.defineProperty(envelope, ORIGINAL_ERROR, {
        value: new Error("x"),
      });
    }).toThrow();
  });
});

describe("every producer carries provenance, not just the one it was built for", () => {
  it("rides on the shared flattener the read and single paths spread", () => {
    // The first version attached this at ONE producer and reached only the
    // collection writes. `typedErrorEnvelopeFields` IS the flattening for the
    // read paths and the singles — the same reason they record the error here
    // rather than each remembering to — so the provenance belongs here too.
    const thrown = NextlyError.internal({
      cause: new Error("driver: deadlock detected"),
      logContext: { table: "posts" },
    });

    const envelope = { success: false, ...typedErrorEnvelopeFields(thrown) };

    expect(originalErrorOf(envelope)).toBe(thrown);
    expect(JSON.stringify(envelope)).not.toContain("deadlock");
  });

  it("chains through the validation branch too", () => {
    // Validation reconstructs down its own path, which forwarded everything
    // except the cause.
    const thrown = NextlyError.internal({
      logContext: { transform: "slugify" },
    });

    const rebuilt = errorFromServiceEnvelope(
      { code: "VALIDATION_ERROR", statusCode: 400, message: "Invalid." },
      {},
      thrown
    );

    expect(rebuilt.cause).toBe(thrown);
  });
});
