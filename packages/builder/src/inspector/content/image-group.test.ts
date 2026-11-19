/**
 * An image's source and alt text as groups: which props join, which mode the
 * stored values are in, read as the block reads them, and what each change
 * writes.
 */
import { describe, expect, it } from "vitest";

import {
  addressChanges,
  mediaPickChanges,
  altModeOf,
  altTextChanges,
  decorativeChanges,
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
    expect([...source.drawn]).toStrictEqual(["mediaId", "src"]);
    expect([...alt.drawn]).toStrictEqual(["alt", "decorative"]);
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
    expect(
      addressChanges(source, " /b.jpg ", { mediaId: "m-1" })
    ).toStrictEqual({
      src: "/b.jpg",
      mediaId: undefined,
    });
  });

  it("names no file where none is stored, so a lock on it does not refuse", () => {
    expect(addressChanges(source, "/b.jpg", {})).toStrictEqual({
      src: "/b.jpg",
    });
  });

  it("removes the address for an emptied field, and keeps the file", () => {
    expect(
      addressChanges(source, "  ", { mediaId: "m-1", src: "/a" })
    ).toStrictEqual({ src: undefined });
  });
});

describe("what picking a library file writes", () => {
  // Strict: a change naming `src: undefined` removes the address, so its
  // presence is the property, and a loose match would ignore it.
  const placed = [{ src: "/example.jpg" }, { src: "/variant.jpg" }];

  it("keeps an author's own address, as the file's fallback", () => {
    expect(
      mediaPickChanges(source, "m-2", { src: "/photo.jpg" }, placed)
    ).toStrictEqual({ mediaId: "m-2" });
  });

  it("removes an address the block was placed with, in the same edit", () => {
    expect(
      mediaPickChanges(source, "m-2", { src: "/variant.jpg" }, placed)
    ).toStrictEqual({ mediaId: "m-2", src: undefined });
  });

  it("names no address where none is stored", () => {
    expect(mediaPickChanges(source, "m-2", {}, placed)).toStrictEqual({
      mediaId: "m-2",
    });
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

  it("stores typed words as the page's own", () => {
    expect(altTextChanges(alt, " A tabby cat ", {}, "Lib")).toStrictEqual({
      alt: "A tabby cat",
    });
    expect(
      altTextChanges(alt, "New words", { alt: "Old words" }, undefined)
    ).toStrictEqual({ alt: "New words" });
  });

  it("stores nothing for the words already in use", () => {
    // The library's words, shown as the value in use, committed unchanged:
    // storing them would stop the image following the library's.
    expect(altTextChanges(alt, "Lib", {}, "Lib")).toStrictEqual({});
    expect(altTextChanges(alt, "Own", { alt: "Own" }, "Lib")).toStrictEqual({});
  });

  it("removes the page's own words for an emptied field, so the library's apply", () => {
    expect(altTextChanges(alt, "  ", { alt: "Old" }, "Lib")).toStrictEqual({
      alt: undefined,
    });
    // Nothing stored and nothing typed: nothing to write.
    expect(altTextChanges(alt, "", {}, undefined)).toStrictEqual({});
  });

  it("marks the image decorative alone, keeping the alt for switching back", () => {
    expect(decorativeChanges(alt, true, { alt: "Kept" })).toStrictEqual({
      decorative: true,
    });
    expect(
      decorativeChanges(alt, false, { alt: "Kept", decorative: true })
    ).toStrictEqual({ decorative: undefined });
  });

  it("names no mark for a stored false, which the block reads as not decorative", () => {
    // Inside a content-only area the mark may not change while the alt may,
    // so naming it would refuse a change that means nothing.
    expect(decorativeChanges(alt, false, { decorative: false })).toStrictEqual(
      {}
    );
  });
});
