import { describe, expect, it } from "vitest";

import { DEFAULT_NEXT, sanitizeNext } from "./redirect";

describe("sanitizeNext", () => {
  it("keeps a rooted same-origin path", () => {
    expect(sanitizeNext("/admin/collections/posts")).toBe(
      "/admin/collections/posts"
    );
  });

  it("keeps a path carrying a query string and fragment", () => {
    expect(sanitizeNext("/admin/media?page=2#top")).toBe(
      "/admin/media?page=2#top"
    );
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["empty", ""],
  ])("falls back to the default when %s", (_label, input) => {
    expect(sanitizeNext(input)).toBe(DEFAULT_NEXT);
  });

  // Each of these is a way of writing "somewhere else" that a browser accepts
  // and a naive `startsWith("/")` check does not catch.
  it.each([
    ["an absolute http URL", "https://evil.example/admin"],
    ["a scheme-relative URL", "//evil.example/admin"],
    ["a backslash authority", "/\\evil.example/admin"],
    ["a double backslash", "\\\\evil.example"],
    ["a percent-encoded scheme-relative URL", "%2f%2fevil.example"],
    ["a percent-encoded backslash authority", "%2f%5cevil.example"],
    ["a javascript scheme", "javascript:alert(1)"],
    ["a data scheme", "data:text/html,<script>alert(1)</script>"],
    ["a bare relative path", "admin/collections"],
    ["a protocol with folded slashes", "https:/\\evil.example"],
  ])("rejects %s", (_label, input) => {
    expect(sanitizeNext(input)).toBe(DEFAULT_NEXT);
  });

  it("rejects a value carrying a CR or LF that could split the Location header", () => {
    expect(sanitizeNext("/admin\r\nSet-Cookie: a=b")).toBe(DEFAULT_NEXT);
    expect(sanitizeNext("/admin\nLocation: https://evil.example")).toBe(
      DEFAULT_NEXT
    );
  });

  it("rejects a value carrying a NUL, tab or DEL", () => {
    // Built from code points rather than written literally: a raw control
    // character in a source file is invisible in review and does not survive
    // every editor or copy intact.
    const nul = String.fromCharCode(0);
    const tab = String.fromCharCode(9);
    const del = String.fromCharCode(127);
    expect(sanitizeNext(`/admin${nul}`)).toBe(DEFAULT_NEXT);
    expect(sanitizeNext(`/admin${tab}x`)).toBe(DEFAULT_NEXT);
    expect(sanitizeNext(`/admin${del}`)).toBe(DEFAULT_NEXT);
  });

  it("rejects a percent-encoded CRLF, which only appears after decoding", () => {
    expect(sanitizeNext("/admin%0d%0aSet-Cookie:%20a=b")).toBe(DEFAULT_NEXT);
  });

  it("falls back when the value is not valid percent-encoding", () => {
    expect(sanitizeNext("/admin%")).toBe(DEFAULT_NEXT);
    expect(sanitizeNext("%zz")).toBe(DEFAULT_NEXT);
  });

  it("keeps a lone slash", () => {
    expect(sanitizeNext("/")).toBe("/");
  });
});
