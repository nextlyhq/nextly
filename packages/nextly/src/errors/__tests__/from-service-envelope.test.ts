// One converter, used by every boundary that hands a service failure back.
//
// Each boundary used to keep its own table of statuses, and each omitted
// different codes, so the same hook failure surfaced as 429 through one and a
// 500 through the next. These pin the behaviour all of them now share.

import { describe, expect, it } from "vitest";

import {
  errorFromServiceEnvelope,
  typedErrorEnvelopeFields,
} from "../from-service-envelope";
import { NextlyError } from "../nextly-error";

describe("errorFromServiceEnvelope", () => {
  it("keeps a code the canonical set does not contain", () => {
    const err = errorFromServiceEnvelope({
      statusCode: 402,
      code: "ACME_QUOTA_EXHAUSTED",
      message: "Quota exhausted.",
    });
    expect(err.code).toBe("ACME_QUOTA_EXHAUSTED");
    expect(err.statusCode).toBe(402);
  });

  it("carries every public field the error had", () => {
    const err = errorFromServiceEnvelope({
      statusCode: 429,
      code: "RATE_LIMITED",
      message: "Too many requests.",
      messageKey: "errors.rateLimited",
      publicData: { retryAfterSeconds: 30 },
    });
    expect(err.publicMessage).toBe("Too many requests.");
    expect(err.messageKey).toBe("errors.rateLimited");
    expect(err.publicData).toEqual({ retryAfterSeconds: 30 });
  });

  it("falls back to the status when no code was recorded", () => {
    // Envelopes are still built by hand in places, and they must keep working.
    expect(errorFromServiceEnvelope({ statusCode: 404 }).code).toBe(
      "NOT_FOUND"
    );
    expect(errorFromServiceEnvelope({ statusCode: 403 }).code).toBe(
      "FORBIDDEN"
    );
    expect(errorFromServiceEnvelope({}).code).toBe("INTERNAL_ERROR");
  });

  it("normalises the legacy field shape into the canonical path one", () => {
    // SingleResult still emits `{field}`; the admin maps `{path}` onto inputs.
    const err = errorFromServiceEnvelope({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      errors: [{ field: "title", message: "Title is required." }],
    });
    expect((err.publicData as { errors: unknown[] }).errors).toEqual([
      { path: "title", code: "INVALID", message: "Title is required." },
    ]);
  });
});

describe("typedErrorEnvelopeFields", () => {
  it("round-trips a typed error through the envelope and back", () => {
    // The two halves are only useful together: a converter can rebuild nothing
    // the catch did not record.
    const original = NextlyError.rateLimited({ retryAfterSeconds: 15 });
    const fields = typedErrorEnvelopeFields(original);
    expect(fields).not.toBeNull();

    const rebuilt = errorFromServiceEnvelope(fields!);
    expect(rebuilt.code).toBe(original.code);
    expect(rebuilt.statusCode).toBe(original.statusCode);
    expect(rebuilt.publicMessage).toBe(original.publicMessage);
    expect(rebuilt.publicData).toEqual(original.publicData);
  });

  it("reports nothing for an untyped error, so callers keep their fallback", () => {
    expect(typedErrorEnvelopeFields(new Error("boom"))).toBeNull();
  });
});
