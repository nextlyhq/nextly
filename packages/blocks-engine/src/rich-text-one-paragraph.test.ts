import { describe, expect, it } from "vitest";

import {
  isOneParagraphProp,
  isRichTextValue,
  oneParagraphWords,
  richTextToPlainText,
  TEXT_FORMAT,
  toOneParagraph,
  type RichTextNode,
  type RichTextValue,
} from "./rich-text";

const value = (children: RichTextNode[]): RichTextValue => ({
  root: { type: "root", children },
});

const text = (words: string, format = 0): RichTextNode => ({
  type: "text",
  text: words,
  format,
});

const paragraph = (...children: RichTextNode[]): RichTextNode => ({
  type: "paragraph",
  children,
});

/** The one paragraph's children, which is everything a restriction keeps. */
const kept = (input: unknown): unknown =>
  toOneParagraph(input).value.root.children;

describe("isOneParagraphProp", () => {
  it("is true only for an explicit true", () => {
    expect(isOneParagraphProp({ type: "textarea", oneParagraph: true })).toBe(
      true
    );
    for (const other of [
      undefined,
      {},
      { oneParagraph: "true" },
      { oneParagraph: 1 },
    ]) {
      expect(isOneParagraphProp(other)).toBe(false);
    }
  });
});

describe("toOneParagraph: words saved as a string", () => {
  it("reads a string as one paragraph, each \\n a line break", () => {
    expect(kept("First line\nSecond line\r\n\nFourth")).toEqual([
      paragraph(
        text("First line"),
        { type: "linebreak" },
        text("Second line"),
        { type: "linebreak" },
        { type: "linebreak" },
        text("Fourth")
      ),
    ]);
    expect(toOneParagraph("a\nb").dropped).toBe(false);
  });

  it("reads a stored number as its words and anything else as empty", () => {
    expect(kept(2024)).toEqual([paragraph(text("2024"))]);
    for (const other of [undefined, null, true, { nope: true }, []]) {
      expect(kept(other)).toEqual([paragraph()]);
    }
  });

  it("always answers a value every rich-text reader can walk", () => {
    for (const input of ["", "x", null, value([]), { root: {} }]) {
      expect(isRichTextValue(toOneParagraph(input).value)).toBe(true);
    }
  });
});

describe("toOneParagraph: rich text", () => {
  it("keeps one paragraph of bold, italic, links and line breaks as it is", () => {
    const stored = value([
      paragraph(
        text("Plain "),
        text("bold", TEXT_FORMAT.BOLD),
        text(" and ", 0),
        text("both", TEXT_FORMAT.BOLD | TEXT_FORMAT.ITALIC),
        { type: "linebreak" },
        {
          type: "link",
          url: "https://example.com/a",
          target: "_blank",
          rel: "nofollow",
          children: [text("a link", TEXT_FORMAT.ITALIC)],
        }
      ),
    ]);
    const restricted = toOneParagraph(stored);
    expect(restricted.dropped).toBe(false);
    expect(restricted.value).toEqual(stored);
  });

  it("drops marks other than bold and italic, keeping the words and the kept marks", () => {
    const restricted = toOneParagraph(
      value([
        paragraph(
          text("under", TEXT_FORMAT.UNDERLINE | TEXT_FORMAT.BOLD),
          text(" code", TEXT_FORMAT.CODE),
          { type: "text", text: " red", format: 0, style: "color: red" }
        ),
      ])
    );
    expect(restricted.dropped).toBe(true);
    expect(restricted.value.root.children).toEqual([
      paragraph(text("under", TEXT_FORMAT.BOLD), text(" code red")),
    ]);
  });

  it("reads headings, lists and quotes as their words, one line each", () => {
    const restricted = toOneParagraph(
      value([
        { type: "heading", tag: "h2", children: [text("How we work")] },
        paragraph(text("We start with "), text("a visit", TEXT_FORMAT.BOLD)),
        {
          type: "list",
          listType: "bullet",
          children: [
            { type: "listitem", children: [text("Colorado")] },
            {
              type: "listitem",
              children: [
                text("Wyoming"),
                {
                  type: "list",
                  children: [{ type: "listitem", children: [text("Nested")] }],
                },
              ],
            },
          ],
        },
        { type: "quote", children: [text("Quoted")] },
      ])
    );
    expect(restricted.dropped).toBe(true);
    expect(restricted.value.root.children).toEqual([
      paragraph(
        text("How we work"),
        { type: "linebreak" },
        text("We start with "),
        text("a visit", TEXT_FORMAT.BOLD),
        { type: "linebreak" },
        text("Colorado"),
        { type: "linebreak" },
        text("Wyoming"),
        { type: "linebreak" },
        text("Nested"),
        { type: "linebreak" },
        text("Quoted")
      ),
    ]);
  });

  it("keeps a link's words but never an address this format cannot express", () => {
    for (const url of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "",
      42,
    ]) {
      const restricted = toOneParagraph(
        value([paragraph({ type: "link", url, children: [text("Click")] })])
      );
      expect(restricted.dropped, String(url)).toBe(true);
      expect(restricted.value.root.children).toEqual([
        paragraph(text("Click")),
      ]);
    }
  });

  it("keeps only a new-tab target and a rel of plain words", () => {
    const restricted = toOneParagraph(
      value([
        paragraph({
          type: "link",
          url: "/about",
          target: "parent-frame",
          rel: '" onclick="x',
          children: [text("About")],
        }),
      ])
    );
    expect(restricted.value.root.children).toEqual([
      paragraph({ type: "link", url: "/about", children: [text("About")] }),
    ]);
  });

  it("flattens a link inside a link to its words", () => {
    expect(
      kept(
        value([
          paragraph({
            type: "link",
            url: "/outer",
            children: [
              text("outer "),
              { type: "link", url: "/inner", children: [text("inner")] },
            ],
          }),
        ])
      )
    ).toEqual([
      paragraph({
        type: "link",
        url: "/outer",
        children: [text("outer inner")],
      }),
    ]);
  });

  it("drops media, buttons and unknown nodes, keeping any words they carry", () => {
    const restricted = toOneParagraph(
      value([
        paragraph(
          text("Before "),
          { type: "image", src: "/a.png" },
          { type: "code-highlight", text: "x()" },
          { type: "mystery", children: [text(" inside")] }
        ),
        { type: "horizontalrule" },
      ])
    );
    expect(restricted.dropped).toBe(true);
    // An unknown container is read as a block, as the plain-text reader reads
    // it, so its words start a line of their own.
    expect(restricted.value.root.children).toEqual([
      paragraph(text("Before x()"), { type: "linebreak" }, text(" inside")),
    ]);
  });

  it("survives malformed children without reading them as words", () => {
    const restricted = toOneParagraph(
      value([
        paragraph(
          text("ok"),
          null as never,
          "words" as never,
          {
            type: 5,
          } as never
        ),
      ])
    );
    expect(restricted.dropped).toBe(true);
    expect(restricted.value.root.children).toEqual([paragraph(text("ok"))]);
  });

  it("splits a text leaf's own \\n into line breaks", () => {
    expect(kept(value([paragraph(text("a\nb", TEXT_FORMAT.BOLD))]))).toEqual([
      paragraph(
        text("a", TEXT_FORMAT.BOLD),
        { type: "linebreak" },
        text("b", TEXT_FORMAT.BOLD)
      ),
    ]);
  });

  it("is idempotent, so a saved value reads back as itself", () => {
    const once = toOneParagraph(
      value([
        { type: "heading", children: [text("Title", TEXT_FORMAT.UNDERLINE)] },
        paragraph(text("Body")),
      ])
    ).value;
    const twice = toOneParagraph(once);
    expect(twice.dropped).toBe(false);
    expect(twice.value).toEqual(once);
  });

  it("keeps the words of a value nested too deep to walk whole", () => {
    let node: RichTextNode = text("deep");
    for (let i = 0; i < 60_000; i++) node = { type: "list", children: [node] };
    const restricted = toOneParagraph(value([node]));
    expect(restricted.dropped).toBe(true);
    expect(isRichTextValue(restricted.value)).toBe(true);
  });

  it("reads the words a plain-text reader reads", () => {
    const restricted = toOneParagraph(
      value([paragraph(text("One")), paragraph(text("Two"))])
    ).value;
    expect(richTextToPlainText(restricted)).toBe("One Two");
  });
});

describe("oneParagraphWords", () => {
  it("reads a Text's words, its marks left out and its line breaks as spaces", () => {
    expect(
      oneParagraphWords(
        value([
          paragraph(
            text("Bold", TEXT_FORMAT.BOLD),
            { type: "linebreak" },
            { type: "link", url: "/a", children: [text("linked")] }
          ),
        ])
      )
    ).toBe("Bold linked");
    expect(oneParagraphWords("Old\nstring")).toBe("Old string");
    expect(oneParagraphWords({ nope: true })).toBe("");
  });
});
