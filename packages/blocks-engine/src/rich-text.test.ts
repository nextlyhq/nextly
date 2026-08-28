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

describe("richTextToPlainText around a block-like leaf", () => {
  it("separates a node that carries its own text but is drawn as a block", () => {
    /*
     * NESTED, which is the shape the editor actually produces: Lexical's
     * decorator nodes are inline unless one overrides `isInline()`, and none of
     * this editor's do, so inserting a button with the caret in a paragraph
     * makes it a CHILD of that paragraph between two text runs.
     *
     * A fixture that put the button between two ROOT paragraphs would pass
     * against a walk that separates it from what follows and welds it to what
     * came before, because the preceding paragraph's own boundary supplies the
     * missing space. This one cannot: both sides are inside one paragraph.
     */
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Before" },
              { type: "button-link", text: "Buy now" },
              { type: "text", text: "After" },
            ],
          },
        ])
      )
    ).toBe("Before Buy now After");
  });

  it("reads the labels a button group keeps in a list of its own", () => {
    /*
     * `button-group` stores each label under `buttons[].text`, and the renderer
     * draws every one. A walk reading only `text` and `children` sees neither,
     * so the words on the page are missing from the description of it.
     */
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Choose" },
              {
                type: "button-group",
                // The REAL serialized shape: a button group's items are not
                // nodes and carry no `type`. A fixture that invents one gets
                // past a node-shaped guard and proves nothing about storage.
                buttons: [
                  {
                    url: "/basic",
                    text: "Basic",
                    variant: "filled",
                    size: "md",
                  },
                  { url: "/pro", text: "Pro", variant: "outline", size: "md" },
                ],
              },
              { type: "text", text: "today" },
            ],
          },
        ])
      )
    ).toBe("Choose Basic Pro today");
  });

  it("omits a label the renderer would not draw", () => {
    /*
     * A reader draws nothing for a button whose URL this format cannot express
     * — a missing one, or a scheme outside the allowed set — so reporting its
     * label would describe the page by a word that never appears on it. That is
     * the mirror of the defect that made these labels worth reading at all.
     */
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Only" },
              {
                type: "button-group",
                buttons: [
                  { url: "javascript:alert(1)", text: "Danger" },
                  { text: "No link at all" },
                  { url: "/real", text: "Real" },
                ],
              },
              { type: "text", text: "this" },
            ],
          },
        ])
      )
    ).toBe("Only Real this");
  });

  it("reports a numeric label the renderer draws as text", () => {
    /*
     * The renderer treats a finite NUMBER as authored text, so a stored
     * `text: 0` — a legacy row, an import, a migration — draws the character
     * "0" on the page. A string-only check here described that page by a label
     * it does carry, which is the same disagreement between two readers of one
     * document that the URL check above exists to prevent.
     *
     * `0` specifically, because it is the value a truthiness test also drops:
     * a fix written as `text ? text : null` passes for `2024` and fails here.
     */
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Pick" },
              {
                type: "button-group",
                buttons: [
                  { url: "/zero", text: 0 },
                  { url: "/year", text: 2024 },
                ],
              },
              { type: "text", text: "one" },
            ],
          },
        ])
      )
    ).toBe("Pick 0 2024 one");
  });

  it("still omits a stored value no reader would draw as text", () => {
    /*
     * The control on the other side. Accepting every non-string would report
     * `true` and `[object Object]` — artefacts of the conversion rather than
     * anything an author wrote — so a rule of "stringify whatever is there"
     * passes the test above and describes the page by words nobody typed.
     */
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Only" },
              {
                type: "button-group",
                buttons: [
                  { url: "/a", text: true },
                  { url: "/b", text: { label: "nested" } },
                  { url: "/c", text: ["x"] },
                  { url: "/d", text: Number.NaN },
                  { url: "/e", text: "Real" },
                ],
              },
              { type: "text", text: "this" },
            ],
          },
        ])
      )
    ).toBe("Only Real this");
  });

  it("skips a button group carrying no labels rather than inventing a gap", () => {
    // The control: a group with nothing readable must not contribute, and must
    // not throw on shapes storage can hold.
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "Only" },
              { type: "button-group", buttons: [] },
              { type: "button-group", buttons: [{ url: "/x", text: "" }] },
              { type: "text", text: "this" },
            ],
          },
        ])
      )
    ).toBe("Only this");
  });

  it("separates one between root paragraphs too", () => {
    // The shape a stored document can also hold, kept because the two travel
    // different paths through the walk.
    expect(
      richTextToPlainText(
        value([
          { type: "paragraph", children: [{ type: "text", text: "Before" }] },
          { type: "button-link", text: "Buy now" },
          { type: "paragraph", children: [{ type: "text", text: "After" }] },
        ])
      )
    ).toBe("Before Buy now After");
  });

  it("does not put a space between syntax tokens in a code block", () => {
    /*
     * `code-highlight` carries its own text, one node per token, and a code
     * block's tokens are usually not separated by anything. Treating "carries
     * text" as "ends a line" therefore rewrites the code: `foo(bar)` becomes
     * `foo ( bar )`. Measured before this was written — that is what it did.
     */
    expect(
      richTextToPlainText(
        value([
          {
            type: "code",
            children: [
              { type: "code-highlight", text: "foo" },
              { type: "code-highlight", text: "(" },
              { type: "code-highlight", text: "bar" },
              { type: "code-highlight", text: ")" },
            ],
          },
        ])
      )
    ).toBe("foo(bar)");
  });

  it("still joins text leaves split only by formatting", () => {
    /*
     * The control, and the property the case above must not buy at its
     * expense. Lexical splits a run at every change of format, so `prefix`
     * with a bold second half is two adjacent leaves — a boundary between them
     * would read as `pre fix`.
     */
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "pre" },
              { type: "text", text: "fix", format: 1 },
            ],
          },
        ])
      )
    ).toBe("prefix");
  });

  it("still keeps an inline link inside its line", () => {
    // The other half of the control: a link is a container AND inline, so it
    // must not earn a boundary either.
    expect(
      richTextToPlainText(
        value([
          {
            type: "paragraph",
            children: [
              { type: "text", text: "see " },
              { type: "link", children: [{ type: "text", text: "here" }] },
              { type: "text", text: " now" },
            ],
          },
        ])
      )
    ).toBe("see here now");
  });
});
