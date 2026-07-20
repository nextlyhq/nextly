/**
 * Rich text is displayed as text in read-only views, so extraction has to keep
 * block boundaries and must never leak editor internals into the UI.
 */
import { describe, it, expect } from "vitest";

import { isLexicalDocument, richTextToText } from "../rich-text-to-text";

function doc(children: unknown[]) {
  return { root: { type: "root", children } };
}

function paragraph(...texts: string[]) {
  return {
    type: "paragraph",
    children: texts.map(text => ({ type: "text", text })),
  };
}

describe("richTextToText", () => {
  it("reads the text of a single paragraph", () => {
    expect(richTextToText(doc([paragraph("Hello world")]))).toBe("Hello world");
  });

  it("keeps paragraphs on separate lines", () => {
    expect(richTextToText(doc([paragraph("One"), paragraph("Two")]))).toBe(
      "One\nTwo"
    );
  });

  it("joins formatted runs within a paragraph without a break", () => {
    // Bold and links are separate text nodes; they are one sentence.
    expect(richTextToText(doc([paragraph("Hello ", "bold", " world")]))).toBe(
      "Hello bold world"
    );
  });

  it("keeps list items on separate lines", () => {
    const list = {
      type: "list",
      children: [
        { type: "listitem", children: [{ type: "text", text: "First" }] },
        { type: "listitem", children: [{ type: "text", text: "Second" }] },
      ],
    };

    expect(richTextToText(doc([list]))).toBe("First\nSecond");
  });

  it("reads nested inline nodes such as links", () => {
    const withLink = {
      type: "paragraph",
      children: [
        { type: "text", text: "See " },
        { type: "link", children: [{ type: "text", text: "the docs" }] },
      ],
    };

    expect(richTextToText(doc([withLink]))).toBe("See the docs");
  });

  it("drops empty blocks rather than emitting blank lines", () => {
    expect(
      richTextToText(doc([paragraph("One"), paragraph(""), paragraph("Two")]))
    ).toBe("One\nTwo");
  });

  it("returns nothing for a value that is not a Lexical document", () => {
    // Dumping serialized editor JSON into the UI reads as a bug; an empty
    // result lets the caller show its own empty state.
    expect(richTextToText({ some: "object" })).toBe("");
    expect(richTextToText("plain string")).toBe("");
    expect(richTextToText(null)).toBe("");
  });

  it("keeps text that appears before any block has opened", () => {
    // A malformed document can carry a bare text node at root level. Writing
    // to index -1 would set a named property on the array and drop it.
    expect(richTextToText(doc([{ type: "text", text: "Stray" }]))).toBe(
      "Stray"
    );
  });

  it("keeps the caption of a media-only document", () => {
    // A document holding only an image has no text node; without reading the
    // caption the field would display as though it were never filled in.
    const image = {
      type: "image",
      altText: "A chart",
      caption: "Revenue by quarter",
    };

    expect(richTextToText(doc([image]))).toContain("Revenue by quarter");
  });

  it("keeps a soft break as a boundary", () => {
    // Shift+Enter serializes as a linebreak node. Without treating it as a
    // boundary the surrounding runs concatenate into "HelloWorld".
    const withBreak = {
      type: "paragraph",
      children: [
        { type: "text", text: "Hello" },
        { type: "linebreak" },
        { type: "text", text: "World" },
      ],
    };

    expect(richTextToText(doc([withBreak]))).toBe("Hello\nWorld");
  });

  it("keeps the labels of a button group", () => {
    // A button group holds its visible text in buttons[].text and has no
    // children, so a CTA-only document would otherwise extract as empty.
    const group = {
      type: "button-group",
      buttons: [{ text: "Get started" }, { text: "Read the docs" }],
    };

    const result = richTextToText(doc([group]));

    expect(result).toContain("Get started");
    expect(result).toContain("Read the docs");
  });

  it("starts a new line for a decorator that carries its own text", () => {
    // A button link is a visible element, not a continuation of the paragraph
    // before it, so its label must not join onto that text.
    const button = { type: "button-link", text: "Click" };

    expect(richTextToText(doc([paragraph("Intro"), button]))).toBe(
      "Intro\nClick"
    );
  });

  it("keeps gallery image labels", () => {
    // A gallery with no caption of its own keeps its labels on the images.
    const gallery = {
      type: "gallery",
      images: [{ alt: "First shot" }, { title: "Second shot" }],
    };

    const result = richTextToText(doc([gallery]));

    expect(result).toContain("First shot");
    expect(result).toContain("Second shot");
  });

  it("returns nothing for an empty document", () => {
    expect(richTextToText(doc([]))).toBe("");
  });
});

describe("isLexicalDocument", () => {
  it("recognizes a document", () => {
    expect(isLexicalDocument(doc([]))).toBe(true);
  });

  it("rejects arbitrary JSON that merely has a root key", () => {
    expect(isLexicalDocument({ root: { type: "other", children: [] } })).toBe(
      false
    );
    expect(isLexicalDocument({ root: "x" })).toBe(false);
    expect(isLexicalDocument(null)).toBe(false);
  });
});
