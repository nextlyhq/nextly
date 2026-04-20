import { describe, it, expect } from "vitest";

import { generateCsrfToken } from "../generate.js";
import { csrfTokensMatch, validateOrigin } from "../validate.js";

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
