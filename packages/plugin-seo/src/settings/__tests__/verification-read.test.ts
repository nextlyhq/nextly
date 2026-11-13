/**
 * The verification codes as the home page's head reads them from the stored
 * settings: a document saved before the field existed (or a database not yet
 * migrated, whose read has no such value) gives no tags and no warning; a
 * value edited past the screen that fails its rule gives no tags, never the
 * value, and is warned about once however often the home page is answered.
 */
import { describe, expect, it, vi } from "vitest";

import { verificationTagsFrom } from "../rules";

describe("verificationTagsFrom", () => {
  it("is nothing, quietly, for settings stored before the field existed", () => {
    const warn = vi.fn();
    const before: Record<string, unknown> = { siteName: "Nextly" };
    expect(verificationTagsFrom(before.verificationCodes, warn)).toEqual({});
    expect(verificationTagsFrom(null, warn)).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });

  it("is the saved tags for a value that passes its rule", () => {
    expect(verificationTagsFrom({ bing: "8A2F61C4" }, vi.fn())).toEqual({
      "msvalidate.01": "8A2F61C4",
    });
  });

  it("ignores a hand-edited value its rule refuses, warning once", () => {
    const warn = vi.fn();
    const edited = { google: '"><script>alert(1)</script>' };
    expect(verificationTagsFrom(edited, warn)).toEqual({});
    expect(verificationTagsFrom(edited, warn)).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).not.toContain("<script>");
  });
});
