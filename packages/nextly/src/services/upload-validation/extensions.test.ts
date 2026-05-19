import { describe, expect, it } from "vitest";

import {
  BLOCKED_EXTENSIONS,
  getExtension,
  isBlockedExtension,
} from "./extensions";

describe("getExtension", () => {
  it("returns the lowercased extension", () => {
    expect(getExtension("photo.JPG")).toBe("jpg");
  });

  it("returns the last extension only", () => {
    expect(getExtension("archive.tar.gz")).toBe("gz");
  });

  it("returns empty string when no extension", () => {
    expect(getExtension("noext")).toBe("");
  });

  it("returns empty string when the dot is the final char", () => {
    expect(getExtension("trailing.")).toBe("");
  });
});

describe("isBlockedExtension", () => {
  it("blocks .html", () => {
    expect(isBlockedExtension("page.html")).toBe(true);
  });

  it("blocks uppercase .HTML", () => {
    expect(isBlockedExtension("page.HTML")).toBe(true);
  });

  it("blocks .js, .mjs, .cjs", () => {
    expect(isBlockedExtension("a.js")).toBe(true);
    expect(isBlockedExtension("a.mjs")).toBe(true);
    expect(isBlockedExtension("a.cjs")).toBe(true);
  });

  it("blocks server-side script extensions", () => {
    expect(isBlockedExtension("a.php")).toBe(true);
    expect(isBlockedExtension("a.phtml")).toBe(true);
    expect(isBlockedExtension("a.aspx")).toBe(true);
    expect(isBlockedExtension("a.jsp")).toBe(true);
  });

  it("blocks OS executable extensions", () => {
    expect(isBlockedExtension("a.exe")).toBe(true);
    expect(isBlockedExtension("a.sh")).toBe(true);
    expect(isBlockedExtension("a.bat")).toBe(true);
    expect(isBlockedExtension("a.dll")).toBe(true);
  });

  it("does NOT block .svg (sanitized, not blocked)", () => {
    expect(isBlockedExtension("logo.svg")).toBe(false);
  });

  it("does NOT block .png, .jpg, .pdf", () => {
    expect(isBlockedExtension("photo.png")).toBe(false);
    expect(isBlockedExtension("photo.jpg")).toBe(false);
    expect(isBlockedExtension("doc.pdf")).toBe(false);
  });

  it("does NOT block files with no extension", () => {
    expect(isBlockedExtension("noext")).toBe(false);
  });
});

describe("BLOCKED_EXTENSIONS", () => {
  it("does not contain svg (sanitized, not blocked)", () => {
    expect(BLOCKED_EXTENSIONS.has("svg")).toBe(false);
  });
});
