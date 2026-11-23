/**
 * The site's security headers, and the two a response may set for itself.
 *
 * Every response gets the site's headers. A response that set its own
 * Content-Security-Policy or Referrer-Policy keeps it, so a handler can serve
 * something more strictly than the site's defaults (a private file's
 * download: sandboxed, no referrer); every other header is the site's,
 * whatever the response set, so a handler cannot loosen those.
 */
import { describe, expect, it } from "vitest";

import { createSecurityHeadersMiddleware } from "./security-headers";

const apply = createSecurityHeadersMiddleware();

describe("createSecurityHeadersMiddleware", () => {
  it("adds the site's policies to a response that set none", () => {
    const res = apply(new Response("ok"));
    expect(res.headers.get("content-security-policy")).toContain(
      "default-src 'self'"
    );
    expect(res.headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("keeps a response's own Content-Security-Policy and Referrer-Policy", () => {
    const res = apply(
      new Response("file", {
        headers: {
          "Content-Security-Policy": "sandbox",
          "Referrer-Policy": "no-referrer",
        },
      })
    );
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("sets every other header to the site's, whatever the response set", () => {
    const res = apply(
      new Response("x", { headers: { "X-Frame-Options": "ALLOWALL" } })
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
});
