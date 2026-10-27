/**
 * An access gate's refusal is logged where it reaches its caller.
 *
 * The gate returns its refusal with the reason on it and logs nothing, since a
 * caller may only be asking whether it may (whether to overlay a draft, say)
 * and then succeed. Every boundary that answers a caller with a service's
 * refusal converts it through `errorFromServiceEnvelope`, so that is where the
 * reason is logged, once.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { container } from "../../di/container";
import { errorFromServiceEnvelope } from "../from-service-envelope";

describe("a gate's refusal, as its caller is answered", () => {
  const info = vi.fn();

  beforeAll(() => {
    container.register("logger", () => ({
      debug: vi.fn(),
      info,
      warn: vi.fn(),
      error: vi.fn(),
    }));
  });
  afterAll(() => {
    container.clear();
  });

  it("logs the reason it carries, and keeps it out of the answer", () => {
    const error = errorFromServiceEnvelope({
      statusCode: 403,
      code: "FORBIDDEN",
      message: "You can't edit posts.",
      refusalReason: "the caller may not update posts",
    });
    expect(error).toMatchObject({
      code: "FORBIDDEN",
      publicMessage: "You can't edit posts.",
    });
    expect(error.logContext).toMatchObject({
      reason: "the caller may not update posts",
    });
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Refused"),
      expect.objectContaining({
        status: 403,
        code: "FORBIDDEN",
        reason: "the caller may not update posts",
      })
    );
  });

  it("logs nothing for a failure that is not a gate's refusal", () => {
    info.mockClear();
    errorFromServiceEnvelope({ statusCode: 404, code: "NOT_FOUND" });
    expect(info).not.toHaveBeenCalled();
  });
});
