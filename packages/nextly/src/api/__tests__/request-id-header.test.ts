/**
 * Adding the request id must never reject a response.
 *
 * A handler can return a response whose headers are immutable — anything from
 * `Response.redirect(...)`, or one passed straight through from `fetch()`.
 * Setting a header on those throws, and the throw happens after the handler
 * has already succeeded, so it would convert a working route into a rejected
 * request rather than merely losing the header.
 */

import { describe, expect, it } from "vitest";

import { withRequestIdHeader } from "../request-id";

describe("withRequestIdHeader", () => {
  it("adds the id to an immutable response without throwing", () => {
    const redirect = Response.redirect("https://example.test/next", 302);
    // The premise, asserted rather than assumed: this response really does
    // refuse mutation, so the test is exercising the case it names.
    expect(() => redirect.headers.set("x-request-id", "x")).toThrow(TypeError);

    const identified = withRequestIdHeader(redirect, "req-1");

    expect(identified.headers.get("x-request-id")).toBe("req-1");
    expect(identified.status).toBe(302);
    expect(identified.headers.get("location")).toBe(
      "https://example.test/next"
    );
  });

  it("adds the id to an ordinary response", () => {
    const identified = withRequestIdHeader(
      new Response("{}", {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
      "req-2"
    );

    expect(identified.headers.get("x-request-id")).toBe("req-2");
    expect(identified.status).toBe(201);
    expect(identified.headers.get("content-type")).toBe("application/json");
  });

  it("leaves an id the handler already set", () => {
    // A handler that set one meant it, and the caller may already have been
    // told; overwriting would break the join it was set for.
    const original = new Response(null, {
      headers: { "x-request-id": "handler-chose-this" },
    });

    const identified = withRequestIdHeader(original, "req-3");

    expect(identified.headers.get("x-request-id")).toBe("handler-chose-this");
    // Returned as-is when nothing needs changing, so an untouched response is
    // not needlessly rebuilt.
    expect(identified).toBe(original);
  });
});
