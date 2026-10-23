/**
 * A refusal the auth middleware builds is answered in the one error body every
 * other error uses: `{ error: { code, message, requestId } }`, as
 * `application/problem+json`, with the request id also in `x-request-id`.
 *
 * Its status, the code it names and the message it carries are kept as they
 * were; the headers it carries, such as `Retry-After`, stay headers and never
 * appear in the body. The exported guard helpers answer the same way.
 */
import { describe, expect, it } from "vitest";

import {
  createErrorResponse as guardRefusal,
  createJsonErrorResponse as guardResponse,
} from "../../guards/require-permission";
import {
  createErrorResponse,
  createJsonErrorResponse,
} from "../error-response";

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("a refusal is answered in the one error body", () => {
  it("as the route gate refuses a caller", async () => {
    const res = createJsonErrorResponse(
      createErrorResponse(
        403,
        "Forbidden",
        "You do not have permission to read posts"
      )
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    const requestId = res.headers.get("x-request-id");
    expect(requestId).toMatch(/^req_/);
    expect(await bodyOf(res)).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to read posts",
        requestId,
      },
    });
  });

  it("keeping the code a refusal names", async () => {
    // The admin refreshes a session only on this code, so it must survive.
    const res = createJsonErrorResponse(
      createErrorResponse(
        401,
        "Session expired",
        "Your session has expired, please refresh",
        undefined,
        "TOKEN_EXPIRED"
      )
    );
    expect(res.status).toBe(401);
    expect(await bodyOf(res)).toMatchObject({
      error: { code: "TOKEN_EXPIRED" },
    });
  });

  it("keeping a limit's headers as headers, out of the body", async () => {
    const res = createJsonErrorResponse(
      createErrorResponse(
        429,
        "Too Many Requests",
        "Rate limit exceeded for this API key",
        { "Retry-After": "30", "X-RateLimit-Limit": "100" }
      )
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.headers.get("x-ratelimit-limit")).toBe("100");
    const body = await bodyOf(res);
    expect(body).toMatchObject({
      error: {
        code: "RATE_LIMITED",
        message: "Rate limit exceeded for this API key",
      },
    });
    expect(JSON.stringify(body)).not.toContain("X-RateLimit-Limit");
  });

  it("from the exported guard helpers too", async () => {
    // As `requireApiKey` builds it: what the caller should read, then the
    // HTTP reason.
    const res = guardResponse(
      guardRefusal(401, "Missing API key", "Unauthorized")
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(await bodyOf(res)).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Missing API key",
        requestId: res.headers.get("x-request-id"),
      },
    });
  });
});
