/**
 * `ctx.auth.verifyCsrf` reads the body's csrfToken, like core routes.
 *
 * The check used to hand the validator an empty body, so a plugin form
 * posting the cookie/body token pair core admin requests use was refused for
 * lacking the header it never needed anywhere else.
 */
import { describe, expect, it } from "vitest";

import {
  CHUNK,
  countingBody,
  MAX_CSRF_BODY_BYTES,
  PRIMED,
} from "../csrf/__tests__/counting-body";
import { createPluginAuthApi } from "../plugin-auth-api";

const api = createPluginAuthApi(() => {
  throw new Error("verifyCsrf must not need the rest of the deps");
});

function request(body: string): Request {
  return new Request("http://localhost:3000/admin/api/x", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "nextly_csrf=tok",
      origin: "http://localhost:3000",
    },
    body,
  });
}

describe("verifyCsrf", () => {
  it("accepts the cookie/body token pair, with no header", async () => {
    const verdict = await api.verifyCsrf(
      request(JSON.stringify({ csrfToken: "tok", anything: "else" }))
    );
    expect(verdict.valid).toBe(true);
  });

  it("still refuses a mismatched body token", async () => {
    const verdict = await api.verifyCsrf(
      request(JSON.stringify({ csrfToken: "wrong" }))
    );
    expect(verdict.valid).toBe(false);
  });

  it("still accepts a non-JSON body when the header matches the cookie", async () => {
    const withHeader = new Request("http://localhost:3000/admin/api/x", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        cookie: "nextly_csrf=tok",
        "x-csrf-token": "tok",
        origin: "http://localhost:3000",
      },
      body: "not json",
    });
    const verdict = await api.verifyCsrf(withHeader);
    expect(verdict.valid).toBe(true);
  });
});

/**
 * The helper runs before the token is known to be valid, so what it reads is
 * spent on a request that may be forged. It reads through the same bounded
 * reader as the route option's check: `request.clone().json()` let a chunked
 * body of any size be buffered before the refusal.
 */
describe("verifyCsrf's body read", () => {
  function streamed(
    body: ReadableStream<Uint8Array>,
    headers: Record<string, string>
  ): Request {
    return new Request("http://localhost:3000/admin/api/x", {
      method: "POST",
      headers: { origin: "http://localhost:3000", ...headers },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  }

  it("reads nothing when the token came in the header", async () => {
    const body = countingBody(256);
    const verdict = await api.verifyCsrf(
      streamed(body.stream, {
        cookie: "nextly_csrf=tok",
        "x-csrf-token": "tok",
      })
    );
    expect(verdict.valid).toBe(true);
    expect(body.read()).toBeLessThanOrEqual(PRIMED);
  });

  it("stops at the cap and says so, instead of buffering the body", async () => {
    // 1 MB offered, chunked, with no header to make the body unnecessary.
    const body = countingBody(256);
    const verdict = await api.verifyCsrf(
      streamed(body.stream, { cookie: "nextly_csrf=tok" })
    );
    expect(verdict).toEqual({ valid: false, reason: "body-too-large" });
    expect(body.read()).toBeLessThanOrEqual(
      MAX_CSRF_BODY_BYTES + CHUNK + PRIMED
    );
  });
});
