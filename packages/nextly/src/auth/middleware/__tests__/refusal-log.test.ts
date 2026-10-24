/**
 * A refusal's reason is recorded on the server and never sent to the caller.
 *
 * The caller reads what was refused in plain words; which check refused, and
 * on what grant, goes to the installation's log alone.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { container } from "../../../di/container";
import {
  createErrorResponse,
  createJsonErrorResponse,
  type ErrorResponse,
} from "../error-response";

describe("a refusal's reason", () => {
  const info = vi.fn();

  // The installation's logger, taken away again after.
  afterAll(() => {
    container.clear();
  });
  beforeAll(() => {
    container.register("logger", () => ({
      debug: vi.fn(),
      info,
      warn: vi.fn(),
      error: vi.fn(),
    }));
  });

  it("is logged on the server, and never sent", async () => {
    const refusal: ErrorResponse = {
      ...createErrorResponse(403, "Forbidden", "You can't edit this post."),
      reason: "the caller does not hold update-posts",
    };
    const res = createJsonErrorResponse(refusal);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Refused"),
      expect.objectContaining({
        status: 403,
        reason: "the caller does not hold update-posts",
      })
    );
    const body = await res.text();
    expect(body).toContain("You can't edit this post.");
    expect(body).not.toContain("update-posts");
  });
});
