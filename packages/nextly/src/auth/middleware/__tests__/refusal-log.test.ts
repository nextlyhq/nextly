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

  it("carries the id the caller is answered with", async () => {
    info.mockClear();
    // No id of the request's own, so the one answered is made here, once.
    const request = new Request("http://localhost/api/posts");
    const res = createJsonErrorResponse(
      {
        ...createErrorResponse(403, "Forbidden", "You can't edit this post."),
        reason: "the caller does not hold update-posts",
      },
      request
    );
    const answered = res.headers.get("x-request-id");
    expect(answered).toMatch(/^req_/);
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining("Refused"),
      expect.objectContaining({ requestId: answered })
    );
  });

  it("is still answered when the logger fails", async () => {
    info.mockImplementationOnce(() => {
      throw new Error("the log transport is down");
    });
    const res = createJsonErrorResponse(
      createErrorResponse(403, "Forbidden", "You can't edit this post.")
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("You can't edit this post.");
  });
});
