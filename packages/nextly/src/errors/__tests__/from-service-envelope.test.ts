// One converter, used by every boundary that hands a service failure back.
//
// Each boundary used to keep its own table of statuses, and each omitted
// different codes, so the same hook failure surfaced as 429 through one and a
// 500 through the next. These pin the behaviour all of them now share.

import { describe, expect, it } from "vitest";

import { originalErrorOf } from "../original-error";

import {
  errorFromServiceEnvelope,
  errorEnvelopeFields,
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

describe("errorEnvelopeFields", () => {
  it("round-trips a typed error through the envelope and back", () => {
    // The two halves are only useful together: a converter can rebuild nothing
    // the catch did not record.
    const original = NextlyError.rateLimited({ retryAfterSeconds: 15 });
    const fields = errorEnvelopeFields(original);
    expect(fields).not.toBeNull();

    const rebuilt = errorFromServiceEnvelope(fields!);
    expect(rebuilt.code).toBe(original.code);
    expect(rebuilt.statusCode).toBe(original.statusCode);
    expect(rebuilt.publicMessage).toBe(original.publicMessage);
    expect(rebuilt.publicData).toEqual(original.publicData);
  });

  it("lifts no fields from an untyped error, but still carries it", () => {
    // The contract is now "always spreadable". An untyped error has no code,
    // status or message worth lifting — inventing one would have the boundary
    // rebuild a fabricated error — so nothing is lifted. It leaves with the
    // provenance alone, which is what a raw driver rejection has to offer and
    // what the typed-only guard used to discard.
    const raw = new Error("boom");
    const fields = errorEnvelopeFields(raw);

    expect(Object.keys(fields)).toEqual([]);
    expect(originalErrorOf(fields)).toBe(raw);
  });
});

describe("validation issues reach the caller in either envelope shape", () => {
  it("reads them from publicData when that is where they are", () => {
    // A read path carries the error's `publicData` verbatim -- that is where
    // `NextlyError.validation` puts the issues. Reading only the top-level
    // `errors` replaced a hook's field paths with a fabricated placeholder, so
    // the admin mapped nothing onto its inputs.
    const err = errorFromServiceEnvelope({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [{ path: "title", code: "TOO_SHORT", message: "Too short." }],
      },
    });

    expect((err.publicData as { errors: unknown[] }).errors).toEqual([
      { path: "title", code: "TOO_SHORT", message: "Too short." },
    ]);
  });

  it("prefers the envelope's own errors when a write path lifted them", () => {
    // The write path normalises the legacy `{field}` key on the way out, so its
    // array is the more canonical of the two when both are present.
    const err = errorFromServiceEnvelope({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      errors: [{ field: "slug", message: "Already taken." }],
      publicData: { errors: [{ path: "ignored", message: "stale" }] },
    });

    expect((err.publicData as { errors: unknown[] }).errors).toEqual([
      { path: "slug", code: "INVALID", message: "Already taken." },
    ]);
  });

  it("still falls back when there are no issues at all", () => {
    const err = errorFromServiceEnvelope({ statusCode: 400 });
    expect(
      (err.publicData as { errors: { path: string }[] }).errors[0].path
    ).toBe("request");
  });
});

describe("a localized validation error keeps its message and key", () => {
  it("does not replace them with the factory's defaults", () => {
    // `NextlyError.validation` hardcodes "Validation failed." and takes no
    // message key, so rebuilding through it dropped both and a client selecting
    // its text by key fell back to the default string.
    const err = errorFromServiceEnvelope({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Le formulaire est invalide.",
      messageKey: "errors.form.invalid",
      publicData: { errors: [{ path: "title", message: "Requis." }] },
    });

    expect(err.publicMessage).toBe("Le formulaire est invalide.");
    expect(err.messageKey).toBe("errors.form.invalid");
    // ...and the per-field issues still reach the admin.
    expect((err.publicData as { errors: unknown[] }).errors).toEqual([
      { path: "title", code: "INVALID", message: "Requis." },
    ]);
  });

  it("still falls back to the canonical text when none was carried", () => {
    const err = errorFromServiceEnvelope({
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });
    expect(err.publicMessage).toBe("Validation failed.");
  });
});

describe("a code-less 400 does not put internal text on the wire", () => {
  it("uses the canonical validation message, not the envelope's", () => {
    // Legacy converters store a raw exception's `message` in a code-less 400.
    // Promoting that to the public message would ship internal paths and driver
    // detail to the client. Only an envelope that says VALIDATION_ERROR is
    // trusted to carry public text.
    const err = errorFromServiceEnvelope({
      statusCode: 400,
      message: "ENOENT: no such file or directory, open '/srv/app/.nextly/x'",
    });

    expect(err.publicMessage).toBe("Validation failed.");
    expect(err.publicMessage).not.toContain("/srv/app");
  });

  it("still trusts a typed validation envelope's message", () => {
    // The mirror: the localized message a validation error legitimately
    // carries must survive, which is what the code is for.
    const err = errorFromServiceEnvelope({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Le formulaire est invalide.",
    });

    expect(err.publicMessage).toBe("Le formulaire est invalide.");
  });

  it("keeps a per-field issue's own code through normalization", () => {
    // The legacy Single array carries `{field, message}`; without the reason
    // travelling with it, a hook's REQUIRED arrives as a generic INVALID.
    const err = errorFromServiceEnvelope({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      errors: [{ field: "title", code: "REQUIRED", message: "Required." }],
    });

    expect(
      (err.publicData as { errors: { code: string }[] }).errors[0].code
    ).toBe("REQUIRED");
  });
});

describe("a typed 409 is not flattened into a generic conflict", () => {
  it("keeps DUPLICATE and its public fields", () => {
    // A status-only branch that ran first rebuilt every 409 as CONFLICT, so a
    // duplicate -- and a plugin 409 carrying its own key and data -- lost what
    // told them apart.
    const err = errorFromServiceEnvelope({
      statusCode: 409,
      code: "DUPLICATE",
      message: "Resource already exists.",
      messageKey: "errors.duplicate",
    });

    expect(err.code).toBe("DUPLICATE");
    expect(err.messageKey).toBe("errors.duplicate");
  });

  it("still defaults a code-less 409 to staleness", () => {
    // The mirror: without a code, telling the user to refresh is the safer
    // answer than implying the write was invalid.
    expect(errorFromServiceEnvelope({ statusCode: 409 }).code).toBe("CONFLICT");
  });
});
