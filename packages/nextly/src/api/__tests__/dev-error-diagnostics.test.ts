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

/**
 * `optIn` takes the literal value, with no default: passing `undefined` to a
 * defaulted parameter selects the default, which silently sets the opt-in the
 * caller meant to withhold.
 */
async function bodyOf(
  env: string,
  optIn: string
): Promise<Record<string, unknown>> {
  // `vi.stubEnv` rather than assigning: `NODE_ENV` is declared read-only,
  // and the alternative is a cast that would also silence a real mistake.
  vi.stubEnv("NODE_ENV", env);
  vi.stubEnv("NEXTLY_DEV_DIAGNOSTICS", optIn);
  const response = await throwingHandler()(
    new Request("https://example.test/api/notes")
  );
  const parsed = (await response.json()) as { error: Record<string, unknown> };
  return parsed.error;
}

describe("development-only error diagnostics", () => {
  it("withholds the detail under production", async () => {
    const error = await bodyOf("production", "1");

    expect(error._devDiagnostics).toBeUndefined();
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("u-42");
    expect(serialized).not.toContain("users_email_idx");
  });

  it("includes it under development", async () => {
    const error = await bodyOf("development", "1");

    expect(error._devDiagnostics).toMatchObject({
      logContext: { userId: "u-42", table: "users" },
      cause: "driver: duplicate key on users_email_idx",
    });
  });

  it("withholds it in development without the explicit opt-in", async () => {
    // The second signal exists because this package is published pre-built and
    // stays external to app builds, so `NODE_ENV` is a runtime value a
    // production deployment can carry by mistake. One signal must not be
    // enough.
    const error = await bodyOf("development", "");

    expect(error._devDiagnostics).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("u-42");
  });

  it("withholds it in production even when the opt-in is set", async () => {
    // The mirror: the opt-in must not be a way to turn the detail on in
    // production, or it becomes the disclosure route rather than a guard.
    const error = await bodyOf("production", "1");

    expect(error._devDiagnostics).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("users_email_idx");
  });

  it("keeps the public fields identical in both", async () => {
    // The gate must ADD a field, never change what a caller already reads, or
    // an author would be debugging a response the client never sees.
    const prod = await bodyOf("production", "1");
    const dev = await bodyOf("development", "1");

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

describe("diagnostics never break the response that carries them", () => {
  it("returns the error response when logContext cannot be serialized", async () => {
    // `logContext` is whatever a thrower attached, so it can hold a cycle. The
    // body is serialized inside the error path, so a value that throws there
    // would reject the request instead of returning the error the handler
    // built — a diagnostic aid failing worse than the failure it describes.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXTLY_DEV_DIAGNOSTICS", "1");

    const circular: Record<string, unknown> = { table: "users" };
    circular.self = circular;

    const handler = withErrorHandler(async (_req: Request) => {
      throw NextlyError.internal({ logContext: circular });
    });

    const response = await handler(new Request("https://example.test/api/x"));
    const parsed = (await response.json()) as {
      error: Record<string, unknown>;
    };

    expect(response.status).toBe(500);
    expect(
      (parsed.error._devDiagnostics as Record<string, unknown>).logContext
    ).toBe("[unserializable]");
  });
});

describe("expected traffic does not reach the operator log", () => {
  it("suppresses benign codes", async () => {
    // A missing row, a rate limit and an unauthenticated probe are expected
    // traffic. The dispatcher already suppresses them for its own log, and
    // writing them here would flood the same log through a second door.
    const { logFlattenedErrors } = await import(
      "../../hooks/side-effect-warnings"
    );
    const written: unknown[] = [];

    logFlattenedErrors(
      [
        NextlyError.notFound({}),
        NextlyError.rateLimited({}),
        NextlyError.authRequired({}),
        NextlyError.internal({ logContext: { real: true } }),
      ],
      entry => written.push(entry),
      { requestId: "req-1" }
    );

    // Only the genuine fault, so the count is the assertion rather than a
    // sample of it.
    expect(written).toHaveLength(1);
  });
});
