/**
 * Guards the rich-text projection.
 *
 * A comparison is only ever about what its projection KEPT, so the headline
 * here is the set of changes that leave the text byte-identical and must still
 * change the projection: a swapped image, a repointed link, an un-bolded
 * phrase, a heading demoted a level. A projection that drops any of them
 * reports the edit as "unchanged", which is the most reassuring possible way to
 * be wrong.
 *
 * The mirror is guarded too: a property that moves without a user touching it
 * must NOT enter the projection, or re-saving a document would report changes
 * nobody made.
 */
import { describe, expect, it } from "vitest";

import { blockAlignKey, toComparableBlocks } from "../rich-text-blocks";

/** A Lexical text node, in the shape the editor actually serialises. */
function text(value: string, extra: Record<string, unknown> = {}) {
  return {
    type: "text",
    version: 1,
    text: value,
    format: 0,
    detail: 0,
    mode: "normal",
    style: "",
    ...extra,
  };
}

function para(children: unknown[], extra: Record<string, unknown> = {}) {
  return {
    type: "paragraph",
    version: 1,
    format: "",
    indent: 0,
    direction: "ltr",
    children,
    ...extra,
  };
}

function doc(children: unknown[]) {
  return {
    root: {
      type: "root",
      version: 1,
      format: "",
      indent: 0,
      direction: "ltr",
      children,
    },
  };
}

describe("toComparableBlocks — what it refuses", () => {
  it("returns null for a value that is not a rich-text document", () => {
    // Not an empty projection: a caller must be able to tell "nothing to
    // compare" from "this is not comparable at all".
    expect(toComparableBlocks({ nope: true })).toBeNull();
    expect(toComparableBlocks(null)).toBeNull();
    expect(toComparableBlocks("some string")).toBeNull();
  });

  it("projects an empty document as no blocks", () => {
    expect(toComparableBlocks(doc([]))).toEqual([]);
  });
});

describe("toComparableBlocks — structure", () => {
  it("projects one block per top-level child, carrying its text", () => {
    const blocks = toComparableBlocks(
      doc([para([text("Hello")]), para([text("World")])])
    );
    expect(blocks).toHaveLength(2);
    expect(blocks?.[0]).toMatchObject({
      blockType: "paragraph",
      text: "Hello",
    });
    expect(blocks?.[1]).toMatchObject({
      blockType: "paragraph",
      text: "World",
    });
  });

  it("concatenates the text of several inline children into one block", () => {
    const blocks = toComparableBlocks(
      doc([para([text("Hello "), text("world")])])
    );
    expect(blocks?.[0]?.text).toBe("Hello world");
  });
});

describe("toComparableBlocks — changes that leave the text identical", () => {
  it("MUST DIFFER: a swapped image", () => {
    // The defect this projection exists to close. A text-only projection reads
    // no `src`, so replacing the picture reports as no change at all.
    //
    // Asserted on the BLOCK rather than on its text: identity is an ordinary
    // recorded property, not a marker folded into what the reader sees. An
    // earlier version did fold one in, which put `image:/a.png` on screen as
    // though an author had typed it.
    const withImage = (src: string) =>
      doc([
        para([text("See "), { type: "image", version: 1, src, altText: "" }]),
      ]);
    const a = toComparableBlocks(withImage("/a.png"));
    const b = toComparableBlocks(withImage("/b.png"));
    expect(a?.[0]).not.toEqual(b?.[0]);
    // And the reader's text is unchanged by the comparison machinery.
    expect(a?.[0]?.text).toBe("See ");
  });

  it("MUST DIFFER: a swapped gallery image, whose identity is nested", () => {
    // `GalleryNode.exportJSON()` stores identity under `images[].src`, with no
    // top-level property naming a target. A rule that looked for one refused to
    // compare galleries at all — and refusing forces "changed", so a document
    // containing one compared as changed against ITSELF.
    const gallery = (src: string) =>
      doc([
        para([
          {
            type: "gallery",
            version: 1,
            images: [{ src, alt: "" }],
            columns: 2,
            caption: "",
          },
        ]),
      ]);
    expect(toComparableBlocks(gallery("/a.png"))?.[0]).not.toEqual(
      toComparableBlocks(gallery("/b.png"))?.[0]
    );
  });

  it("MUST DIFFER: a repointed link", () => {
    const withLink = (url: string) =>
      doc([
        para([{ type: "link", version: 1, url, children: [text("docs")] }]),
      ]);
    expect(toComparableBlocks(withLink("/docs"))?.[0]).not.toEqual(
      toComparableBlocks(withLink("/guide"))?.[0]
    );
  });

  it("MUST DIFFER: un-bolding a phrase", () => {
    // Lexical carries inline marks as a format bitmask on the text node.
    const bold = toComparableBlocks(doc([para([text("hi", { format: 1 })])]));
    const plain = toComparableBlocks(doc([para([text("hi", { format: 0 })])]));
    expect(bold?.[0]).not.toEqual(plain?.[0]);
  });

  it("MUST DIFFER: demoting a heading", () => {
    const heading = (tag: string) =>
      doc([
        {
          type: "heading",
          version: 1,
          tag,
          format: "",
          indent: 0,
          direction: "ltr",
          children: [text("Title")],
        },
      ]);
    expect(toComparableBlocks(heading("h2"))?.[0]).not.toEqual(
      toComparableBlocks(heading("h3"))?.[0]
    );
  });

  it("MUST DIFFER: changing a list from bulleted to numbered", () => {
    const list = (listType: string) =>
      doc([
        {
          type: "list",
          version: 1,
          listType,
          start: 1,
          tag: listType === "number" ? "ol" : "ul",
          format: "",
          indent: 0,
          direction: "ltr",
          children: [
            {
              type: "listitem",
              version: 1,
              value: 1,
              format: "",
              indent: 0,
              direction: "ltr",
              children: [text("one")],
            },
          ],
        },
      ]);
    expect(toComparableBlocks(list("bullet"))?.[0]).not.toEqual(
      toComparableBlocks(list("number"))?.[0]
    );
  });

  it("MUST DIFFER: re-aligning a paragraph", () => {
    const aligned = (format: string) => doc([para([text("body")], { format })]);
    expect(toComparableBlocks(aligned(""))?.[0]).not.toEqual(
      toComparableBlocks(aligned("center"))?.[0]
    );
  });
});

describe("toComparableBlocks — properties that move on their own", () => {
  it("IDEMPOTENCE: excludes the node schema version and the derived direction", () => {
    // `version` moves when the editor library is upgraded and `direction` is
    // derived from the text's script. Comparing either would report a change
    // nobody made, every time one of them moved.
    const a = toComparableBlocks(
      doc([para([text("Hi")], { version: 1, direction: "ltr" })])
    );
    const b = toComparableBlocks(
      doc([para([text("Hi")], { version: 2, direction: "rtl" })])
    );
    expect(a?.[0]).toEqual(b?.[0]);
  });

  it("IDEMPOTENCE: the same document projects identically twice", () => {
    const value = doc([para([text("stable")]), para([text("also stable")])]);
    expect(toComparableBlocks(value)).toEqual(toComparableBlocks(value));
  });

  it("IDEMPOTENCE: a block projects the same wherever it sits in the document", () => {
    // A block's projection must not depend on its position, or inserting a
    // paragraph would report every later paragraph as changed for having
    // shifted — the index-based comparison the alignment step exists to avoid.
    const alone = toComparableBlocks(doc([para([text("body")])]));
    const preceded = toComparableBlocks(
      doc([para([text("intro")]), para([text("body")])])
    );
    expect(preceded?.[1]).toEqual(alone?.[0]);
  });
});

describe("toComparableBlocks — decorators the editor really produces", () => {
  it("IDEMPOTENCE: a gallery compares equal to itself", () => {
    // The shape `GalleryNode` actually serialises. Previously refused for
    // having no top-level identity property, which made every document
    // containing one report as changed against itself.
    const value = doc([
      para([
        {
          type: "gallery",
          version: 1,
          images: [{ src: "/a.png", alt: "A" }],
          columns: 2,
          caption: "",
        },
      ]),
    ]);
    const projected = toComparableBlocks(value);
    expect(projected?.[0]?.unsupported).toBe(false);
    expect(projected).toEqual(toComparableBlocks(value));
  });

  it("IDEMPOTENCE: a button group compares equal to itself", () => {
    // `ButtonGroupNode.exportJSON()` stores its content under `buttons`, again
    // with no top-level identity property.
    const value = doc([
      para([
        {
          type: "button-group",
          version: 1,
          buttons: [{ text: "Go", url: "/go", variant: "solid" }],
          alignment: "left",
        },
      ]),
    ]);
    expect(toComparableBlocks(value)?.[0]?.unsupported).toBe(false);
    expect(toComparableBlocks(value)).toEqual(toComparableBlocks(value));
  });

  it("IDEMPOTENCE: a line break compares equal to itself", () => {
    // A line break carries only its type — no identity, no text.
    const value = doc([para([text("a"), { type: "linebreak", version: 1 }])]);
    expect(toComparableBlocks(value)?.[0]?.unsupported).toBe(false);
  });

  it("MUST DIFFER: a button group whose link target moved", () => {
    const group = (url: string) =>
      doc([
        para([
          {
            type: "button-group",
            version: 1,
            buttons: [{ text: "Go", url, variant: "solid" }],
            alignment: "left",
          },
        ]),
      ]);
    expect(toComparableBlocks(group("/a"))?.[0]).not.toEqual(
      toComparableBlocks(group("/b"))?.[0]
    );
  });
});

describe("toComparableBlocks — what it genuinely cannot read", () => {
  it("marks a block unsupported when a child is not a node at all", () => {
    // `children` is traversed rather than compared as a value, so silently
    // skipping an unreadable child would let a document containing one compare
    // equal to the same document without it.
    const blocks = toComparableBlocks(doc([para(["not a node"])]));
    expect(blocks?.[0]?.unsupported).toBe(true);
  });

  it("MUST DIFFER: a document with an unreadable child is not equal to one without", () => {
    const withBad = toComparableBlocks(doc([para([text("a"), 42])]));
    const withoutBad = toComparableBlocks(doc([para([text("a")])]));
    expect(withBad?.[0]).not.toEqual(withoutBad?.[0]);
  });

  it("marks a top-level child that is not a node unsupported", () => {
    expect(toComparableBlocks(doc(["not a block"]))?.[0]).toMatchObject({
      blockType: "unknown",
      unsupported: true,
    });
  });

  it("refuses a document nested past its depth bound instead of overflowing", () => {
    // Validation only checks the root's children are node-shaped, so a crafted
    // value can nest arbitrarily. Recursing it would exhaust the call stack and
    // turn a comparison request into a server error.
    let deepest: Record<string, unknown> = {
      type: "text",
      version: 1,
      text: "x",
    };
    for (let i = 0; i < 400; i += 1) {
      deepest = { type: "nested", version: 1, children: [deepest] };
    }
    const blocks = toComparableBlocks(doc([deepest]));
    expect(blocks?.[0]?.unsupported).toBe(true);
  });
});

describe("blockAlignKey", () => {
  it("separates blocks that read alike but are different kinds", () => {
    // Aligning on text alone pairs an inserted heading with an untouched
    // paragraph of the same words, and reports the paragraph as added.
    const heading = doc([
      {
        type: "heading",
        version: 1,
        tag: "h2",
        format: "",
        indent: 0,
        direction: "ltr",
        children: [text("Same")],
      },
    ]);
    const paragraph = doc([para([text("Same")])]);
    const h = toComparableBlocks(heading)?.[0];
    const p = toComparableBlocks(paragraph)?.[0];
    expect(blockAlignKey(h!)).not.toBe(blockAlignKey(p!));
  });

  it("does NOT separate a block from itself after an attribute-only change", () => {
    // A demoted heading must still align with its old self, so the change reads
    // as one changed block rather than a removal beside an addition.
    const heading = (tag: string) =>
      doc([
        {
          type: "heading",
          version: 1,
          tag,
          format: "",
          indent: 0,
          direction: "ltr",
          children: [text("Title")],
        },
      ]);
    const before = toComparableBlocks(heading("h2"))?.[0];
    const after = toComparableBlocks(heading("h3"))?.[0];
    expect(blockAlignKey(before!)).toBe(blockAlignKey(after!));
    expect(before).not.toEqual(after);
  });
});

describe("toComparableBlocks — structure within a block", () => {
  it("MUST DIFFER: text moved between two list items", () => {
    // Both flatten to `abc`, and their block-level attributes match. Only the
    // per-item record separates them — without it the edit is invisible and a
    // modified-only comparison hides the field entirely.
    const list = (first: string, second: string) =>
      doc([
        {
          type: "list",
          version: 1,
          listType: "bullet",
          start: 1,
          tag: "ul",
          format: "",
          indent: 0,
          direction: "ltr",
          children: [
            {
              type: "listitem",
              version: 1,
              value: 1,
              format: "",
              indent: 0,
              direction: "ltr",
              children: [text(first)],
            },
            {
              type: "listitem",
              version: 1,
              value: 2,
              format: "",
              indent: 0,
              direction: "ltr",
              children: [text(second)],
            },
          ],
        },
      ]);
    const a = toComparableBlocks(list("ab", "c"))?.[0];
    const b = toComparableBlocks(list("a", "bc"))?.[0];
    expect(a?.text).toBe(b?.text);
    expect(a).not.toEqual(b);
  });
});
