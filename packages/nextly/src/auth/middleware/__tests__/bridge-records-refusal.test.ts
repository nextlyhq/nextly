/**
 * A refusal thrown to its caller through the bridge is recorded.
 *
 * The standalone routes (`nextly/api/*`), plugin routes and checked Direct API
 * calls all throw what `toNextlyAuthError` returns, with no boundary of their
 * own that writes the refusal's line. The bridge writes it, as a refused REST
 * request's is written when it is answered.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import { createErrorResponse } from "../error-response";
import { toNextlyAuthError } from "../to-nextly-error";

describe("a refusal converted by the bridge", () => {
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

  it("is recorded with its reason", () => {
    toNextlyAuthError({
      ...createErrorResponse(403, "Forbidden", "You can't edit posts."),
      reason: "the caller does not hold update-posts",
    });
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Refused"),
      expect.objectContaining({
        status: 403,
        reason: "the caller does not hold update-posts",
      })
    );
  });
});
