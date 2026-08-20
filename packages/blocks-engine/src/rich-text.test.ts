import { describe, expect, it } from "vitest";

import {
  codeTokenClass,
  isRichTextNode,
  isRichTextValue,
  richTextToPlainText,
  TEXT_FORMAT,
  type RichTextNode,
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
    // The space belongs to the text node, because that is where the author
    // typed it — Lexical stores the separator between a word and a following
    // link inside the preceding leaf, and nothing downstream adds one.
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Hello " },
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

describe("isRichTextNode", () => {
  it("accepts any node with a string type, including one nothing here knows", () => {
    // Permissive about WHICH node, because a site registers its own and this
    // package has no list of them.
    expect(isRichTextNode({ type: "paragraph" })).toBe(true);
    expect(isRichTextNode({ type: "some-plugin-node", payload: 1 })).toBe(true);
  });

  it("rejects the values a malformed `children` array actually holds", () => {
    // Each of these survives JSON round-tripping into a children array, and
    // every one of them throws when a walker reads `.text` off it.
    for (const other of [null, undefined, "text", 0, true, [], { text: "x" }]) {
      expect(isRichTextNode(other), `${JSON.stringify(other)}`).toBe(false);
    }
  });
});

describe("richTextToPlainText", () => {
  it("does not insert a space where formatting split one word", () => {
    // Lexical ends a text node at every format change, so a part-bold word
    // arrives as two adjacent leaves. Joining leaves with a space would put a
    // space inside the word and index `pre fix` for what the author typed as
    // `prefix`.
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "pre" },
              { type: "text", text: "fix", format: TEXT_FORMAT.BOLD },
            ],
          },
        ])
      )
    ).toBe("prefix");
  });

  it("does not push punctuation away from the word it follows", () => {
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Hello" },
              { type: "text", text: ",", format: TEXT_FORMAT.BOLD },
              { type: "text", text: " there" },
            ],
          },
        ])
      )
    ).toBe("Hello, there");
  });

  it("keeps a link's text against the words around it", () => {
    // A link is inline: it interrupts formatting, not the sentence.
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "see " },
              { type: "link", children: [{ type: "text", text: "docs" }] },
              { type: "text", text: " now" },
            ],
          },
        ])
      )
    ).toBe("see docs now");
  });

  it("separates at a line break", () => {
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "one" },
              { type: "linebreak" },
              { type: "text", text: "two" },
            ],
          },
        ])
      )
    ).toBe("one two");
  });

  it("survives a tree deep enough to overflow a recursive walk", () => {
    // The document limits count block nodes, not the objects inside one prop,
    // so nesting like this is reachable well under the size cap. A recursive
    // implementation throws RangeError here and takes the request with it.
    let node: RichTextNode = { type: "text", text: "bottom" };
    for (let i = 0; i < 20_000; i++) {
      node = { type: "paragraph", children: [node] };
    }
    expect(richTextToPlainText(value([node]))).toBe("bottom");
  });

  it("skips a malformed child instead of throwing", () => {
    const malformed = {
      root: { type: "root", children: [null, { type: "text", text: "kept" }] },
    } as unknown as RichTextValue;
    expect(richTextToPlainText(malformed)).toBe("kept");
  });
});

describe("richTextToPlainText malformed children", () => {
  it("skips a string child instead of emitting it as text", () => {
    // The walk marks block boundaries with a sentinel of its own. A string
    // sentinel would be forgeable from storage: this `"injected"` would be read
    // back as the marker and pushed into the output as if an author had typed
    // it.
    const malformed = {
      root: {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: ["injected", { type: "text", text: "real" }],
          },
        ],
      },
    } as unknown as RichTextValue;
    expect(richTextToPlainText(malformed)).toBe("real");
  });

  it("skips a node whose children are not an array", () => {
    const malformed = {
      root: {
        type: "root",
        children: [
          { type: "paragraph", children: "oops" },
          { type: "paragraph", children: [{ type: "text", text: "kept" }] },
        ],
      },
    } as unknown as RichTextValue;
    expect(richTextToPlainText(malformed)).toBe("kept");
  });
});

describe("codeTokenClass", () => {
  it("names the class a token type gets", () => {
    expect(codeTokenClass("keyword")).toBe(
      "nextly-code-token nextly-code-token--keyword"
    );
    expect(codeTokenClass("attr-name")).toBe(
      "nextly-code-token nextly-code-token--attr-name"
    );
  });

  it("refuses a type that could break out of a class attribute", () => {
    // The CMS writes this into an HTML string by hand, so a type carrying a
    // quote would close the attribute and inject markup.
    for (const bad of [
      '"><script>alert(1)</script>',
      "Keyword",
      "1keyword",
      "key word",
      "",
      undefined,
      null,
      42,
    ]) {
      expect(codeTokenClass(bad), `${JSON.stringify(bad)}`).toBeUndefined();
    }
  });
});
