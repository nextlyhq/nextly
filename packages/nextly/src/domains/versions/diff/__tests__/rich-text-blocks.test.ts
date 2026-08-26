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

import { toComparableBlocks } from "../rich-text-blocks";

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
    const withImage = (src: string) =>
      doc([
        para([text("See "), { type: "image", version: 1, src, altText: "" }]),
      ]);
    const a = toComparableBlocks(withImage("/a.png"));
    const b = toComparableBlocks(withImage("/b.png"));
    expect(a?.[0]?.text).not.toEqual(b?.[0]?.text);
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

describe("toComparableBlocks — what it cannot read", () => {
  it("marks a decorator carrying no identity and no text as unsupported", () => {
    // A REAL node type this editor registers, not a synthetic one: a synthetic
    // type would travel whatever fall-through an unrecognised node does, and
    // pass whether or not a real node ever reaches the mechanism.
    const blocks = toComparableBlocks(
      doc([para([{ type: "gallery", version: 1 }])])
    );
    expect(blocks?.[0]?.unsupported).toBe(true);
  });

  it("does NOT mark a decorator unsupported when it has an identity", () => {
    // The negative control for the case above: a gallery that names its target
    // is comparable, so the refusal must not fire for the node TYPE alone.
    const blocks = toComparableBlocks(
      doc([para([{ type: "gallery", version: 1, id: "gal-1" }])])
    );
    expect(blocks?.[0]?.unsupported).toBe(false);
    expect(blocks?.[0]?.text).toContain("gal-1");
  });
});
