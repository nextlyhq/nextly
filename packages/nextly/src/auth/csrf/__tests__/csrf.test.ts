import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateCsrfToken } from "../generate";
import { csrfTokensMatch, validateOrigin } from "../validate";

describe("generateCsrfToken", () => {
  it("should generate a 64-character hex string", () => {
    const token = generateCsrfToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it("should generate unique tokens", () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(a).not.toBe(b);
  });
});

describe("csrfTokensMatch", () => {
  it("should return true for matching tokens", () => {
    const token = generateCsrfToken();
    expect(csrfTokensMatch(token, token)).toBe(true);
  });

  it("should return false for different tokens", () => {
    const a = generateCsrfToken();
    const b = generateCsrfToken();
    expect(csrfTokensMatch(a, b)).toBe(false);
  });

  it("should return false for empty strings", () => {
    expect(csrfTokensMatch("", "")).toBe(false);
    expect(csrfTokensMatch("abc", "")).toBe(false);
    expect(csrfTokensMatch("", "abc")).toBe(false);
  });

  it("should return false for different lengths", () => {
    expect(csrfTokensMatch("short", "muchlongertoken")).toBe(false);
  });
});

describe("validateOrigin", () => {
  it("should allow same-origin requests", () => {
    const request = new Request("https://example.com/admin/api/auth/login", {
      headers: { origin: "https://example.com" },
    });
    expect(validateOrigin(request, [])).toBe(true);
  });

  it("should reject cross-origin requests not in allowlist", () => {
    const request = new Request("https://example.com/admin/api/auth/login", {
      headers: { origin: "https://evil.com" },
    });
    expect(validateOrigin(request, [])).toBe(false);
  });

  it("should allow origins in the allowlist", () => {
    const request = new Request("https://example.com/admin/api/auth/login", {
      headers: { origin: "https://trusted.com" },
    });
    expect(validateOrigin(request, ["https://trusted.com"])).toBe(true);
  });

  it("should reject requests with no origin header", () => {
    const request = new Request("https://example.com/admin/api/auth/login");
    expect(validateOrigin(request, [])).toBe(false);
  });

  it("should fall back to referer header", () => {
    const request = new Request("https://example.com/admin/api/auth/login", {
      headers: { referer: "https://example.com/admin/login" },
    });
    expect(validateOrigin(request, [])).toBe(true);
  });
});

describe("validateOrigin with a malformed Referer", () => {
  it("refuses rather than throwing", () => {
    const request = new Request("http://localhost:3000/x", {
      method: "POST",
      headers: { referer: "not a url" },
    });
    expect(validateOrigin(request, [])).toBe(false);
  });
});

/**
 * In development, a page on a loopback address may submit to that same
 * address, even where the app's own address (as `request.url` gives it under
 * `next dev`: the configured host) names another loopback host. Opening the
 * admin at `127.0.0.1` for an app at `localhost` was refused before.
 *
 * Nothing else is loosened. Two listeners on one port at different loopback
 * addresses can be different applications, so another loopback name is still
 * refused, and production keeps the exact check.
 */
describe("validateOrigin: a loopback page submitting to its own address", () => {
  /** A request the app reads as `localhost:3000`, sent to `host`. */
  function sentTo(host: string, origin: string): Request {
    return new Request("http://localhost:3000/admin/api/auth/setup", {
      method: "POST",
      headers: { host, origin },
    });
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("in development", () => {
    beforeEach(() => {
      vi.stubEnv("NODE_ENV", "development");
    });

    it.each([
      ["127.0.0.1:3000", "http://127.0.0.1:3000"],
      ["[::1]:3000", "http://[::1]:3000"],
    ])("accepts a page at %s submitting to that address", (host, origin) => {
      expect(validateOrigin(sentTo(host, origin), [])).toBe(true);
    });

    it("accepts a page at localhost submitting to localhost, where the app reads another name", () => {
      const request = new Request(
        "http://127.0.0.1:3000/admin/api/auth/setup",
        {
          method: "POST",
          headers: { host: "localhost:3000", origin: "http://localhost:3000" },
        }
      );
      expect(validateOrigin(request, [])).toBe(true);
    });

    it("refuses another loopback name of the same port", () => {
      // Possibly another application, listening at [::1]:3000.
      expect(
        validateOrigin(sentTo("127.0.0.1:3000", "http://[::1]:3000"), [])
      ).toBe(false);
    });

    it("refuses a loopback page on another port", () => {
      expect(
        validateOrigin(sentTo("127.0.0.1:3000", "http://127.0.0.1:4000"), [])
      ).toBe(false);
    });

    it("refuses a non-loopback origin, even sent to its own address", () => {
      expect(
        validateOrigin(
          sentTo("192.168.1.5:3000", "http://192.168.1.5:3000"),
          []
        )
      ).toBe(false);
      // A `*.localhost` name is none of the three loopback names either.
      expect(
        validateOrigin(
          sentTo("setup.localhost:3000", "http://setup.localhost:3000"),
          []
        )
      ).toBe(false);
    });

    it("refuses when the request names no address it was sent to", () => {
      const request = new Request(
        "http://localhost:3000/admin/api/auth/setup",
        {
          method: "POST",
          headers: { origin: "http://127.0.0.1:3000" },
        }
      );
      expect(validateOrigin(request, [])).toBe(false);
    });
  });

  it("refuses the same request in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      validateOrigin(sentTo("127.0.0.1:3000", "http://127.0.0.1:3000"), [])
    ).toBe(false);
  });

  it("refuses the same request when NODE_ENV names no environment", () => {
    vi.stubEnv("NODE_ENV", "");
    expect(
      validateOrigin(sentTo("127.0.0.1:3000", "http://127.0.0.1:3000"), [])
    ).toBe(false);
  });
});
