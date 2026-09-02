import { describe, expect, it, vi } from "vitest";

import {
  BLOCKED_MIME_TYPES,
  DEFAULT_ALLOWED_MIME_TYPES,
  resolveAllowlist,
  validateMimeType,
} from "./mime";

describe("BLOCKED_MIME_TYPES", () => {
  it("contains text/html", () => {
    expect(BLOCKED_MIME_TYPES.has("text/html")).toBe(true);
  });

  it("contains application/javascript variants", () => {
    expect(BLOCKED_MIME_TYPES.has("application/javascript")).toBe(true);
    expect(BLOCKED_MIME_TYPES.has("text/javascript")).toBe(true);
  });
});

describe("DEFAULT_ALLOWED_MIME_TYPES", () => {
  it("contains image/svg+xml (allowed; sanitized downstream)", () => {
    expect(DEFAULT_ALLOWED_MIME_TYPES).toContain("image/svg+xml");
  });

  it("allows the two web font formats, and no other font format", () => {
    /*
     * A precondition rather than a nicety: a `@font-face` may not name another
     * host, so a font has to be uploaded before it can be used at all, and an
     * allowlist without these refuses the upload that makes one usable.
     *
     * The negative half is the part worth keeping. TTF and OTF have no
     * conversion step here, so allowing them would store and serve several
     * times the bytes of the same face as WOFF2 with nothing reporting it.
     */
    expect(DEFAULT_ALLOWED_MIME_TYPES).toContain("font/woff2");
    expect(DEFAULT_ALLOWED_MIME_TYPES).toContain("font/woff");
    expect(DEFAULT_ALLOWED_MIME_TYPES).not.toContain("font/ttf");
    expect(DEFAULT_ALLOWED_MIME_TYPES).not.toContain("font/otf");
  });
});

describe("resolveAllowlist", () => {
  it("returns defaults when no override and no additions", () => {
    expect(resolveAllowlist(undefined, undefined)).toEqual([
      ...DEFAULT_ALLOWED_MIME_TYPES,
    ]);
  });

  it("uses explicit allowedMimeTypes as a full override", () => {
    expect(resolveAllowlist(["image/png"], ["image/svg+xml"])).toEqual([
      "image/png",
    ]);
  });

  it("merges additionalMimeTypes with defaults when override is absent", () => {
    const r = resolveAllowlist(undefined, ["application/zip"]);
    expect(r).toContain("application/zip");
    expect(r).toContain("image/png");
  });

  it("deduplicates when additionalMimeTypes overlap defaults", () => {
    const r = resolveAllowlist(undefined, ["image/png", "image/png"]);
    const occurrences = r.filter(t => t === "image/png").length;
    expect(occurrences).toBe(1);
  });

  it("strips blocked types from the allowlist even when explicitly added", () => {
    // Suppress the expected warn so the test output stays clean.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = resolveAllowlist(["text/html", "image/png"], undefined);
    expect(r).not.toContain("text/html");
    expect(r).toContain("image/png");
    warn.mockRestore();
  });

  it("normalizes to lowercase + trim", () => {
    const r = resolveAllowlist(["  IMAGE/PNG "], undefined);
    expect(r).toContain("image/png");
  });
});

describe("validateMimeType", () => {
  const allowlist = ["image/png", "image/svg+xml", "image/*"];

  it("accepts an allowed type", () => {
    expect(validateMimeType("image/png", allowlist)).toEqual({ ok: true });
  });

  it("is case-insensitive on the claimed type", () => {
    expect(validateMimeType("IMAGE/PNG", allowlist)).toEqual({ ok: true });
  });

  it("matches wildcard image/*", () => {
    expect(validateMimeType("image/webp", ["image/*"])).toEqual({ ok: true });
  });

  it("rejects a blocked type even when the allowlist would have permitted it", () => {
    const r = validateMimeType("text/html", ["text/html"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("blocked");
  });

  it("rejects a type not in the allowlist", () => {
    const r = validateMimeType("application/zip", allowlist);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not-allowed");
  });
});
