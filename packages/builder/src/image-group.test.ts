/**
 * An image's source and alt text as groups: which props join, which mode the
 * stored values are in, read as the block reads them, and what each choice
 * writes.
 */
import { describe, expect, it } from "vitest";

import {
  addressChanges,
  altModeChanges,
  altModeOf,
  imageGroupOf,
  sourceModeOf,
  type ImageAltGroup,
  type ImageSourceGroup,
} from "./image-group";

const IMAGE = [
  { name: "mediaId", schema: { type: "media" } },
  { name: "src", schema: { type: "url" } },
  { name: "alt", schema: { type: "text" } },
  { name: "decorative", schema: { type: "checkbox" } },
  { name: "caption", schema: { type: "text" } },
];

const group = imageGroupOf(IMAGE);
const source = group?.source as ImageSourceGroup;
const alt = group?.alt as ImageAltGroup;

describe("which props join", () => {
  it("joins an image's source and its alt text, and nothing else", () => {
    expect([...source.drawn]).toEqual(["mediaId", "src"]);
    expect([...alt.drawn]).toEqual(["alt", "decorative"]);
    expect(alt.media).toBe("mediaId");
  });

  it("is no source for a URL with no library file beside it, as an embed's", () => {
    expect(
      imageGroupOf([
        { name: "src", schema: { type: "url" } },
        { name: "title", schema: { type: "text" } },
      ])
    ).toBeUndefined();
  });

  it("joins by name AND type", () => {
    const typed = imageGroupOf([
      { name: "mediaId", schema: { type: "text" } },
      { name: "src", schema: { type: "url" } },
      { name: "alt", schema: { type: "text" } },
      { name: "decorative", schema: { type: "text" } },
    ]);
    expect(typed).toBeUndefined();
  });
});

describe("where the picture comes from", () => {
  it("is the library while a file is stored, an address beside it included", () => {
    expect(sourceModeOf(source, { mediaId: "m-1" })).toBe("library");
    expect(sourceModeOf(source, { mediaId: "m-1", src: "/a.jpg" })).toBe(
      "library"
    );
  });

  it("is the address where only one is stored, and the library where nothing is", () => {
    expect(sourceModeOf(source, { src: "/a.jpg" })).toBe("url");
    expect(sourceModeOf(source, {})).toBe("library");
    expect(sourceModeOf(source, { mediaId: "  ", src: "" })).toBe("library");
  });

  it("writes a typed address over a stored file, in one edit", () => {
    expect(addressChanges(source, " /b.jpg ", { mediaId: "m-1" })).toEqual({
      src: "/b.jpg",
      mediaId: undefined,
    });
  });

  it("names no file where none is stored, so a lock on it does not refuse", () => {
    expect(addressChanges(source, "/b.jpg", {})).toEqual({ src: "/b.jpg" });
  });

  it("removes the address for an emptied field, and keeps the file", () => {
    expect(addressChanges(source, "  ", { mediaId: "m-1", src: "/a" })).toEqual(
      { src: undefined }
    );
  });
});

describe("what a screen reader is given", () => {
  it("reads decorative first, then the page's alt, then the library's", () => {
    expect(altModeOf(alt, { decorative: true, alt: "Words" })).toBe(
      "decorative"
    );
    expect(altModeOf(alt, { alt: "Words" })).toBe("custom");
    expect(altModeOf(alt, {})).toBe("library");
    expect(altModeOf(alt, { decorative: false })).toBe("library");
  });

  it("reads an empty stored alt as the page's own, as the block draws it", () => {
    // `alt: ""` is drawn as no alt text at all, never the library's.
    expect(altModeOf(alt, { alt: "" })).toBe("custom");
  });

  it("writes From library by removing the page's alt and the mark", () => {
    expect(
      altModeChanges(alt, "library", { alt: "Words", decorative: true }, "Lib")
    ).toEqual({ alt: undefined, decorative: undefined });
    expect(altModeChanges(alt, "library", { alt: "Words" }, "Lib")).toEqual({
      alt: undefined,
    });
  });

  it("writes Custom from the library's words, so a reader hears the same", () => {
    expect(altModeChanges(alt, "custom", {}, "A tabby cat")).toEqual({
      alt: "A tabby cat",
    });
    expect(altModeChanges(alt, "custom", {}, undefined)).toEqual({ alt: "" });
  });

  it("keeps the page's own alt when Custom unmarks a decorative image", () => {
    expect(
      altModeChanges(alt, "custom", { alt: "Kept", decorative: true }, "Lib")
    ).toEqual({ decorative: undefined });
  });

  it("writes Decorative as the mark alone, keeping the alt for switching back", () => {
    expect(altModeChanges(alt, "decorative", { alt: "Kept" }, "Lib")).toEqual({
      decorative: true,
    });
  });
});
