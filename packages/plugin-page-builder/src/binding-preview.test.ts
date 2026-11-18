/**
 * How the binding picker shows a value: its start as text, cut short, the
 * same for the host's listed fields and a list's first entry.
 */
import { describe, expect, it } from "vitest";

import {
  isEmptyValue,
  previewOf,
  rowPreviews,
  thumbnailOf,
} from "./binding-preview";

describe("a value's preview", () => {
  it("shows text trimmed, a number and a yes-or-no", () => {
    expect(previewOf("  Spring sale ")).toBe("Spring sale");
    expect(previewOf(2026)).toBe("2026");
    expect(previewOf(false)).toBe("false");
  });

  it("cuts long text at 80 characters, ending in an ellipsis", () => {
    const shown = previewOf("a".repeat(120));
    expect(shown).toHaveLength(80);
    expect(shown?.endsWith("…")).toBe(true);
    // Text that fits is never cut.
    expect(previewOf("a".repeat(80))).toBe("a".repeat(80));
  });

  it("shows nothing for empty text, a record, a list or nothing", () => {
    expect(previewOf("   ")).toBeUndefined();
    expect(previewOf({ name: "Ada" })).toBeUndefined();
    expect(previewOf(["a"])).toBeUndefined();
    expect(previewOf(null)).toBeUndefined();
  });
});

describe("an entry's previews by path", () => {
  it("previews its fields and one step into a group or a relation", () => {
    expect(
      rowPreviews({
        title: "Highway 9 realignment",
        year: 2026,
        author: { name: "Ada", team: { name: "Survey" } },
        tags: ["roads"],
        cover: null,
      })
    ).toEqual({
      title: "Highway 9 realignment",
      year: "2026",
      "author.name": "Ada",
      // Nothing in it: said as empty, never as "null".
      cover: { empty: true },
    });
  });

  it("shows a picture as its thumbnail, and an empty list as empty", () => {
    expect(
      rowPreviews({
        cover: {
          id: "m1",
          url: "/uploads/cover.jpg",
          thumbnailUrl: "/uploads/cover-thumb.jpg",
          mimeType: "image/jpeg",
        },
        tags: [],
      })
    ).toMatchObject({
      cover: { thumbnail: "/uploads/cover-thumb.jpg" },
      tags: { empty: true },
    });
  });
});

describe("a picture's thumbnail", () => {
  it("is an image's thumbnail, else the image itself", () => {
    expect(
      thumbnailOf({
        url: "https://cdn.example.test/a.jpg",
        thumbnailUrl: "https://cdn.example.test/a-thumb.jpg",
        mimeType: "image/jpeg",
      })
    ).toBe("https://cdn.example.test/a-thumb.jpg");
    expect(
      thumbnailOf({
        url: "/uploads/a.png",
        thumbnailUrl: null,
        mimeType: "image/png",
      })
    ).toBe("/uploads/a.png");
  });

  it("is none for a file that is no picture, an id, or an address no picture is drawn from", () => {
    expect(
      thumbnailOf({ url: "/uploads/brief.pdf", mimeType: "application/pdf" })
    ).toBeUndefined();
    expect(thumbnailOf("m1")).toBeUndefined();
    expect(
      thumbnailOf({ url: "javascript:alert(1)", mimeType: "image/png" })
    ).toBeUndefined();
    expect(
      thumbnailOf({ url: "//elsewhere.test/a.png", mimeType: "image/png" })
    ).toBeUndefined();
  });
});

describe("an empty value", () => {
  it("is nothing, blank text or an empty list; never a zero, a no or a record", () => {
    for (const empty of [null, undefined, "", "  ", []]) {
      expect(isEmptyValue(empty)).toBe(true);
    }
    for (const value of [0, false, "a", ["a"], {}]) {
      expect(isEmptyValue(value)).toBe(false);
    }
  });
});
