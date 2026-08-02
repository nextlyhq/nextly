/**
 * The development-only error detail is gated at build time.
 *
 * `logContext` and `cause` are what the public error shape deliberately
 * withholds, so the gate on them is a disclosure boundary rather than a
 * convenience: it reads `NODE_ENV`, which the bundler replaces at build time,
 * and never a header, query parameter or role. A production bundle therefore
 * cannot be talked into the branch at all.
 *
 * The absence assertion is the load-bearing one. A test that only proved the
 * detail appears in development would stay green if the gate were deleted.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { typedErrorEnvelopeFields } from "../../errors/from-service-envelope";
import { NextlyError } from "../../errors/nextly-error";
import {
  currentFlattenedErrors,
  withSideEffectWarnings,
} from "../../hooks/side-effect-warnings";
import { withErrorHandler } from "../with-error-handler";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A failure carrying exactly the detail the public shape must not disclose. */
function throwingHandler() {
  return withErrorHandler(async (_req: Request) => {
    throw NextlyError.internal({
      cause: new Error("driver: duplicate key on users_email_idx"),
      logContext: { userId: "u-42", table: "users" },
    });
  });
}

async function bodyOf(env: string): Promise<Record<string, unknown>> {
  // `vi.stubEnv` rather than assigning: `NODE_ENV` is declared read-only,
  // and the alternative is a cast that would also silence a real mistake.
  vi.stubEnv("NODE_ENV", env);
  const response = await throwingHandler()(
    new Request("https://example.test/api/notes")
  );
  const parsed = (await response.json()) as { error: Record<string, unknown> };
  return parsed.error;
}

describe("development-only error diagnostics", () => {
  it("withholds the detail under production", async () => {
    const error = await bodyOf("production");

    expect(error._devDiagnostics).toBeUndefined();
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("u-42");
    expect(serialized).not.toContain("users_email_idx");
  });

  it("includes it under development", async () => {
    const error = await bodyOf("development");

    expect(error._devDiagnostics).toMatchObject({
      logContext: { userId: "u-42", table: "users" },
      cause: "driver: duplicate key on users_email_idx",
    });
  });

  it("keeps the public fields identical in both", async () => {
    // The gate must ADD a field, never change what a caller already reads, or
    // an author would be debugging a response the client never sees.
    const prod = await bodyOf("production");
    const dev = await bodyOf("development");

    expect(dev.code).toBe(prod.code);
    expect(dev.message).toBe(prod.message);
  });
});

describe("diagnostics survive every flattening path", () => {
  it("records from typedErrorEnvelopeFields", async () => {
    // That function IS the flattening for the paths that use it, so it records
    // rather than each of its call sites remembering to.
    const { result } = await withSideEffectWarnings(async () => {
      typedErrorEnvelopeFields(
        NextlyError.conflict({ logContext: { constraint: "posts_slug_key" } })
      );
      return currentFlattenedErrors();
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.logContext).toMatchObject({
      constraint: "posts_slug_key",
    });
  });

  it("records nothing for a value that is not a typed error", async () => {
    // The control: it returns null for those, and recording one would put a
    // fabricated entry in the operator log.
    const { result } = await withSideEffectWarnings(async () => {
      typedErrorEnvelopeFields(new Error("plain"));
      return currentFlattenedErrors();
    });

    expect(result).toHaveLength(0);
  });
});

describe("a failing logger cannot replace the response", () => {
  it("returns the handler's response when writing diagnostics throws", async () => {
    // Observability must not poison the result. Losing a log line is
    // recoverable; turning a completed write into a 500 is not.
    const { logFlattenedErrors } = await import(
      "../../hooks/side-effect-warnings"
    );

    expect(() =>
      logFlattenedErrors(
        [NextlyError.internal({ logContext: { a: 1 } })],
        () => {
          throw new Error("logger exploded");
        },
        { requestId: "req-1" }
      )
    ).not.toThrow();
  });
});
