import { describe, expect, it } from "vitest";

import { validateFilename } from "./filename";

describe("validateFilename", () => {
  it("accepts a normal filename", () => {
    expect(validateFilename("photo.jpg")).toEqual({ ok: true });
  });

  it("rejects empty string", () => {
    const r = validateFilename("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("empty");
  });

  it("rejects filenames longer than 255 chars", () => {
    const r = validateFilename("a".repeat(256));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too-long");
  });

  it("rejects filenames with a null byte (polyglot attack)", () => {
    const r = validateFilename("photo.jpg\0.html");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("null-byte");
  });

  it("rejects forward-slash path separators", () => {
    const r = validateFilename("../etc/passwd");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("path-separator");
  });

  it("rejects backslash path separators", () => {
    const r = validateFilename("..\\windows\\system32");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("path-separator");
  });

  it("rejects all-dots filenames", () => {
    expect(validateFilename(".").ok).toBe(false);
    expect(validateFilename("..").ok).toBe(false);
    expect(validateFilename("...").ok).toBe(false);
  });

  it("accepts filenames with embedded dots", () => {
    expect(validateFilename("my.photo.v2.jpg").ok).toBe(true);
  });

  it("accepts filenames at the 255-char boundary", () => {
    expect(validateFilename("a".repeat(255)).ok).toBe(true);
  });
});
