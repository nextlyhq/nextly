/**
 * `ctx.auth.verifyCsrf` reads the body's csrfToken, like core routes.
 *
 * The check used to hand the validator an empty body, so a plugin form
 * posting the cookie/body token pair core admin requests use was refused for
 * lacking the header it never needed anywhere else.
 */
import { describe, expect, it } from "vitest";

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
