/**
 * A busy database reaching a service that answers with an envelope.
 *
 * The collection and Single services catch what their work throws and return
 * `{ success: false, statusCode, message, data: null, ...errorEnvelopeFields(error) }`,
 * choosing 500 for anything that is not a NextlyError. A busy database arrives
 * raw, so without `errorEnvelopeFields` reading it, the caller got that 500 and
 * the driver's message. Each case builds the envelope as those services do,
 * with the fields spread last, and reads it back as a boundary does.
 */
import { poolWaitTimeoutError } from "@nextlyhq/adapter-drizzle/types";
import { describe, expect, it } from "vitest";

import {
  errorEnvelopeFields,
  errorFromServiceEnvelope,
} from "../from-service-envelope";
import { DATABASE_BUSY_RETRY_AFTER_SECONDS } from "../retry-after";

/** The envelope a collection or Single service returns for `error`. */
function serviceEnvelope(error: unknown) {
  const message = error instanceof Error ? error.message : "Failed";
  return {
    success: false,
    statusCode: 500,
    message,
    data: null,
    ...errorEnvelopeFields(error),
  };
}

const RAW_BUSY = [
  {
    name: "the adapters' pool-wait timeout",
    error: poolWaitTimeoutError(15000),
  },
  {
    name: "that timeout wrapped by Drizzle",
    error: new Error("Failed query: select ...", {
      cause: poolWaitTimeoutError(15000),
    }),
  },
  {
    name: "SQLITE_BUSY",
    error: Object.assign(new Error("database is locked"), {
      code: "SQLITE_BUSY",
    }),
  },
];

describe("a service envelope for a busy database", () => {
  for (const { name, error } of RAW_BUSY) {
    it(`carries DATABASE_BUSY and its retry hint for ${name}, not a 500`, () => {
      const envelope = serviceEnvelope(error);

      expect(envelope.statusCode).toBe(503);
      expect(envelope.code).toBe("DATABASE_BUSY");
      expect(envelope.publicData).toEqual({
        retryAfterSeconds: DATABASE_BUSY_RETRY_AFTER_SECONDS,
      });
      // The generic sentence, never the driver's.
      expect(envelope.message).toBe(
        "The database is busy. Please try again shortly."
      );

      const rebuilt = errorFromServiceEnvelope(envelope);
      expect(rebuilt.code).toBe("DATABASE_BUSY");
      expect(rebuilt.statusCode).toBe(503);
      expect(rebuilt.publicData).toEqual({
        retryAfterSeconds: DATABASE_BUSY_RETRY_AFTER_SECONDS,
      });
    });
  }

  it("leaves any other failure the service's own 500", () => {
    const envelope = serviceEnvelope(new Error("relation does not exist"));

    expect(envelope.statusCode).toBe(500);
    expect(envelope.code).toBeUndefined();
  });
});
