import { describe, expect, it } from "vitest";

import {
  isRichTextValue,
  richTextToPlainText,
  type RichTextValue,
} from "./rich-text";

const value = (children: RichTextValue["root"]["children"]): RichTextValue => ({
  root: { type: "root", children },
});

describe("isRichTextValue", () => {
  it("recognises a rooted value", () => {
    expect(isRichTextValue(value([]))).toBe(true);
  });

  it("rejects the shapes a prop actually holds instead", () => {
    // Every one of these is a real stored prop value elsewhere in the format,
    // and a renderer choosing between "draw a tree" and "draw a string" has to
    // tell them apart without guessing.
    for (const other of ["", "text", 0, 42, null, undefined, [], {}]) {
      expect(isRichTextValue(other), `${JSON.stringify(other)}`).toBe(false);
    }
  });

  it("rejects a root that is not rooted", () => {
    // The marker is the SHAPE, because the value arrives from storage as parsed
    // JSON with no class to ask.
    expect(isRichTextValue({ root: { type: "paragraph", children: [] } })).toBe(
      false
    );
    expect(isRichTextValue({ root: { type: "root" } })).toBe(false);
  });
});

describe("richTextToPlainText", () => {
  it("reads text out of a nested tree", () => {
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Hello" },
              { type: "link", children: [{ type: "text", text: "world" }] },
            ],
          },
        ])
      )
    ).toBe("Hello world");
  });

  it("keeps two block-level nodes from becoming one word", () => {
    // Concatenating would produce "firstsecond", which then indexes and reads
    // as a word nobody wrote.
    expect(
      richTextToPlainText(
        value([
          { type: "paragraph", children: [{ type: "text", text: "first" }] },
          { type: "paragraph", children: [{ type: "text", text: "second" }] },
        ])
      )
    ).toBe("first second");
  });

  it("answers empty for an empty document rather than throwing", () => {
    expect(richTextToPlainText(value([]))).toBe("");
  });

  it("ignores nodes carrying no text, without losing their children", () => {
    expect(
      richTextToPlainText(
        value([
          {
            type: "list",
            children: [
              { type: "listitem", children: [{ type: "text", text: "one" }] },
            ],
          },
        ])
      )
    ).toBe("one");
  });
});
