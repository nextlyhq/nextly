/**
 * One table decides what a status means when a failure names no code.
 *
 * Three tables used to. They disagreed: the same code-less 401 reached a Direct
 * API caller as `AUTH_REQUIRED` and a REST caller as `INTERNAL_ERROR`, and a
 * code-less 429 lost its rate-limit identity entirely — and with it the
 * `Retry-After` the boundary reads off `publicData`.
 *
 * The table is a FALLBACK, not a translation. A status is coarser than a code,
 * so a producer that knows which one it means says so, and the table is never
 * consulted for it. Both halves are asserted here: the shared reading, and that
 * naming a code overrides it.
 */

import { describe, expect, it } from "vitest";

import { createErrorFromResult } from "../../direct-api/namespaces/helpers";
import { statusToErrorCode } from "../error-codes";
import { errorFromServiceEnvelope } from "../from-service-envelope";

/** A failure as a legacy service produces one: a status and prose, no code. */
function codeless(statusCode: number, message = "something went wrong") {
  return { success: false, statusCode, message, data: null };
}

describe("the shared table decides a code-less failure", () => {
  it.each([
    [400, "VALIDATION_ERROR"],
    [401, "AUTH_REQUIRED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [413, "PAYLOAD_TOO_LARGE"],
    [415, "UNSUPPORTED_MEDIA_TYPE"],
    [422, "INVALID_INPUT"],
    [429, "RATE_LIMITED"],
    [502, "EXTERNAL_SERVICE_ERROR"],
    [503, "SERVICE_UNAVAILABLE"],
  ])("reads %i as %s", (status, code) => {
    expect(errorFromServiceEnvelope(codeless(status)).code).toBe(code);
  });

  it("reads an unrecognised status as an internal error", () => {
    // Inventing a specific code for a status nobody mapped would assert a
    // meaning no producer expressed.
    expect(errorFromServiceEnvelope(codeless(418)).code).toBe("INTERNAL_ERROR");
  });

  it("keeps the producer's status even when the code implies another", () => {
    // 422 maps to INVALID_INPUT, whose canonical status is 400. The envelope's
    // own status wins, so a legacy producer is not rounded to a status it did
    // not choose.
    const error = errorFromServiceEnvelope(codeless(422));

    expect(error.code).toBe("INVALID_INPUT");
    expect(error.statusCode).toBe(422);
  });
});

describe("the REST and Direct API boundaries now agree", () => {
  // The regression that motivated this: each boundary inferred separately, so
  // the same failure had two identities depending on how the caller arrived.
  it.each([401, 409, 422, 429, 503])(
    "answers a code-less %i identically through both",
    status => {
      const viaConverter = errorFromServiceEnvelope(codeless(status));
      const viaDirectApi = createErrorFromResult({
        ...codeless(status),
        message: "something went wrong",
      });

      expect(viaDirectApi.code).toBe(viaConverter.code);
      expect(viaDirectApi.statusCode).toBe(viaConverter.statusCode);
      expect(viaDirectApi.publicMessage).toBe(viaConverter.publicMessage);
    }
  );
});

describe("a named code is never overridden by the table", () => {
  it("keeps DUPLICATE on a 409 rather than reading it as staleness", () => {
    // The case the table cannot decide. 409 covers a name clash and a stale
    // write, and the two need opposite advice: pick another name, or reload.
    // The table's reading is staleness, so a producer that means the clash has
    // to say so — and be believed.
    const error = errorFromServiceEnvelope({
      success: false,
      statusCode: 409,
      code: "DUPLICATE",
      message: "A folder with this name already exists in this location",
    });

    expect(error.code).toBe("DUPLICATE");
    // And the producer's own sentence reaches the user, because naming the code
    // is the producer taking responsibility for the message too. It is more
    // actionable than the generic "Resource already exists." and still echoes
    // no identifier -- the folder's name stays out of it (spec 13.8).
    expect(error.publicMessage).toBe(
      "A folder with this name already exists in this location"
    );
    // The reading the table would have given, which cannot help someone whose
    // chosen name is taken.
    expect(error.publicMessage).not.toContain("refresh");
  });

  it("keeps a plugin's own code, which is in no table at all", () => {
    const error = errorFromServiceEnvelope({
      success: false,
      statusCode: 409,
      code: "ARCHIVE_LOCKED",
      message: "That archive is locked.",
    });

    expect(error.code).toBe("ARCHIVE_LOCKED");
  });
});

describe("a code-less failure never puts its own message on the wire", () => {
  it("answers with the generic sentence for the derived code", () => {
    // These envelopes come from legacy converters that store a raw exception's
    // text. Promoting it would disclose driver output, table names and internal
    // paths through the one path that has no typed error to vet it.
    const error = errorFromServiceEnvelope(
      codeless(
        500,
        "duplicate key value violates unique constraint users_email_idx"
      )
    );

    expect(error.publicMessage).toBe("An unexpected error occurred.");
    expect(error.publicMessage).not.toContain("users_email_idx");
  });

  it("keeps the detail for the operator", () => {
    const error = errorFromServiceEnvelope(codeless(500, "driver exploded"), {
      legacyMessage: "driver exploded",
      entity: "media",
    });

    expect(error.logContext).toMatchObject({
      legacyMessage: "driver exploded",
      entity: "media",
    });
  });

  it("keeps public data on a derived code, or the code means nothing", () => {
    // `message` is withheld and `publicData` is not, which is not an
    // inconsistency: one is prose a legacy converter may have filled with a raw
    // exception, the other is the structured payload whose purpose is to reach
    // the caller. Dropping it disarms the derived code -- the boundary reads
    // `Retry-After` from `publicData.retryAfterSeconds`, so a 429 that answers
    // RATE_LIMITED without it tells a client to back off and not for how long.
    const error = errorFromServiceEnvelope({
      success: false,
      statusCode: 429,
      message: "slow down",
      publicData: { retryAfterSeconds: 30 },
    });

    expect(error.code).toBe("RATE_LIMITED");
    expect(error.publicData).toMatchObject({ retryAfterSeconds: 30 });
    // The prose is still withheld, so the two rules are covered together.
    expect(error.publicMessage).toBe(
      "Too many requests. Please try again later."
    );
  });

  it("still answers with a rate limit's own message when it named the code", () => {
    // The mirror: a TYPED failure's `publicMessage` was authored to be seen, so
    // the generic sentence must not replace it.
    const error = errorFromServiceEnvelope({
      success: false,
      statusCode: 429,
      code: "RATE_LIMITED",
      message: "Slow down, you may retry in 30 seconds.",
      publicData: { retryAfterSeconds: 30 },
    });

    expect(error.publicMessage).toBe("Slow down, you may retry in 30 seconds.");
    expect(error.publicData).toMatchObject({ retryAfterSeconds: 30 });
  });
});

describe("statusToErrorCode is the only place the reading lives", () => {
  it("agrees with what the converter produces", () => {
    // The converter must not grow a second opinion beside the table it calls.
    for (const status of [400, 401, 403, 404, 409, 429, 503, 418]) {
      const viaTable = statusToErrorCode(status);
      const viaConverter = errorFromServiceEnvelope(codeless(status)).code;
      expect(viaConverter).toBe(viaTable);
    }
  });
});
