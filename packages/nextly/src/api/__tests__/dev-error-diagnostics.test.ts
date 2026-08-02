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

import { NextlyError } from "../../errors/nextly-error";
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
