/**
 * Guards the rich-text diff node.
 *
 * Three properties matter here. Block alignment must survive an insertion, so
 * adding a paragraph does not mark every later paragraph changed. A changed
 * block must carry word-level runs, so the reader sees WHICH words moved. And
 * an uncomparable block must force the FIELD to report changed — the caller
 * filters unchanged fields out of view, so a field that reported unchanged
 * would take its own refusal off the screen.
 */
import { describe, expect, it } from "vitest";

import { richTextNode } from "../rich-text-node";

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

function para(value: string) {
  return {
    type: "paragraph",
    version: 1,
    format: "",
    indent: 0,
    direction: "ltr",
    children: [text(value)],
  };
}

function doc(paragraphs: string[]) {
  return {
    root: {
      type: "root",
      version: 1,
      format: "",
      indent: 0,
      direction: "ltr",
      children: paragraphs.map(para),
    },
  };
}

const meta = { name: "content", label: "Content", type: "richText" };

describe("richTextNode — structure", () => {
  it("reports an added paragraph as one added block, leaving the rest alone", () => {
    const node = richTextNode(meta, doc(["A"]), doc(["A", "B"]));
    expect(node.status).toBe("changed");
    expect(node.blocks.map(b => b.status)).toEqual(["unchanged", "added"]);
  });

  it("reports a removed paragraph as one removed block", () => {
    const node = richTextNode(meta, doc(["A", "B", "C"]), doc(["A", "C"]));
    expect(node.blocks.map(b => b.status)).toEqual([
      "unchanged",
      "removed",
      "unchanged",
    ]);
  });

  it("carries word-level runs on a changed block", () => {
    const node = richTextNode(meta, doc(["hello world"]), doc(["hello there"]));
    expect(node.blocks[0]?.status).toBe("changed");
    const inserted = (node.blocks[0]?.segments ?? []).filter(s => s.op === 1);
    expect(inserted.map(s => s.text).join("")).toContain("there");
    const deleted = (node.blocks[0]?.segments ?? []).filter(s => s.op === -1);
    expect(deleted.map(s => s.text).join("")).toContain("world");
  });

  it("keeps a block's type on the node so the renderer can draw it", () => {
    const node = richTextNode(meta, doc(["A"]), doc(["A", "B"]));
    expect(node.blocks[1]).toMatchObject({
      blockType: "paragraph",
      status: "added",
    });
  });
});

describe("richTextNode — equality", () => {
  it("IDEMPOTENCE: identical documents report unchanged", () => {
    const node = richTextNode(meta, doc(["A", "B"]), doc(["A", "B"]));
    expect(node.status).toBe("unchanged");
    expect(node.blocks.every(b => b.status === "unchanged")).toBe(true);
  });

  it("MUST DIFFER: a block whose text is identical but whose attributes changed", () => {
    // The whole point of comparing more than text. Same words, different
    // heading level — this must not report as unchanged.
    const heading = (tag: string) => ({
      root: {
        type: "root",
        version: 1,
        format: "",
        indent: 0,
        direction: "ltr",
        children: [
          {
            type: "heading",
            version: 1,
            tag,
            format: "",
            indent: 0,
            direction: "ltr",
            children: [text("Title")],
          },
        ],
      },
    });
    const node = richTextNode(meta, heading("h2"), heading("h3"));
    expect(node.status).toBe("changed");
    expect(node.blocks[0]?.status).toBe("changed");
  });
});

describe("richTextNode — saying WHAT changed", () => {
  const heading = (tag: string) => ({
    root: {
      type: "root",
      version: 1,
      format: "",
      indent: 0,
      direction: "ltr",
      children: [
        {
          type: "heading",
          version: 1,
          tag,
          format: "",
          indent: 0,
          direction: "ltr",
          children: [text("Title")],
        },
      ],
    },
  });

  it("carries the property that moved when the words did not", () => {
    // Without this the reader sees a Changed badge above text that reads
    // identically — told that something happened and not what, which is the
    // least useful thing a comparison can say.
    const node = richTextNode(meta, heading("h2"), heading("h3"));
    const changes = node.blocks[0]?.attrChanges ?? [];
    const tag = changes.find(c => c.name.endsWith("tag"));
    expect(tag).toMatchObject({ before: "h2", after: "h3" });
  });

  it("names the property in an editor's terms, not by its internal path", () => {
    const node = richTextNode(meta, heading("h2"), heading("h3"));
    const names = (node.blocks[0]?.attrChanges ?? []).map(c => c.name);
    expect(names.every(n => !n.includes("/"))).toBe(true);
  });

  it("omits the list entirely when nothing but the text changed", () => {
    // Absent rather than empty, so a consumer can tell "no property changed"
    // from "properties were not examined".
    const node = richTextNode(meta, doc(["hello world"]), doc(["hello there"]));
    expect(node.blocks[0]?.attrChanges).toBeUndefined();
  });

  it("does not report a reordered object-valued property as a change", () => {
    // Key order is not content. A serializer upgrade that merely reorders
    // exported properties must not read as an edit.
    const gallery = (image: Record<string, unknown>) => ({
      root: {
        type: "root",
        version: 1,
        format: "",
        indent: 0,
        direction: "ltr",
        children: [
          {
            type: "paragraph",
            version: 1,
            format: "",
            indent: 0,
            direction: "ltr",
            children: [
              { type: "gallery", version: 1, images: [image], columns: 1 },
            ],
          },
        ],
      },
    });
    const node = richTextNode(
      meta,
      gallery({ src: "/a.png", alt: "A" }),
      gallery({ alt: "A", src: "/a.png" })
    );
    expect(node.status).toBe("unchanged");
  });
});

describe("richTextNode — what it cannot compare", () => {
  it("forces the FIELD off unchanged when a block is unsupported", () => {
    // Both sides identical, so a content comparison alone would say unchanged —
    // and `modifiedOnly` would then drop the field and the refusal with it.
    // The unreadable thing is a child that is not a node; a decorator with
    // nested identity is perfectly comparable and must NOT reach here.
    const unreadable = {
      root: {
        type: "root",
        version: 1,
        format: "",
        indent: 0,
        direction: "ltr",
        children: [
          {
            type: "paragraph",
            version: 1,
            format: "",
            indent: 0,
            direction: "ltr",
            children: ["not a node"],
          },
        ],
      },
    };
    const node = richTextNode(meta, unreadable, unreadable);
    expect(node.blocks[0]?.status).toBe("unsupported");
    expect(node.status).not.toBe("unchanged");
  });

  it("IDEMPOTENCE: a document with a gallery compares equal to itself", () => {
    // The regression this guards: a gallery has no top-level identity property,
    // and refusing it forced the whole field to changed on every comparison.
    const withGallery = {
      root: {
        type: "root",
        version: 1,
        format: "",
        indent: 0,
        direction: "ltr",
        children: [
          {
            type: "paragraph",
            version: 1,
            format: "",
            indent: 0,
            direction: "ltr",
            children: [
              {
                type: "gallery",
                version: 1,
                images: [{ src: "/a.png", alt: "" }],
                columns: 2,
                caption: "",
              },
            ],
          },
        ],
      },
    };
    const node = richTextNode(meta, withGallery, withGallery);
    expect(node.status).toBe("unchanged");
    expect(node.blocks.every(b => b.status === "unchanged")).toBe(true);
  });

  it("reports the whole field unsupported when a side is not a document", () => {
    const node = richTextNode(meta, { garbage: true }, doc(["A"]));
    expect(node.blocks).toEqual([
      { blockType: "unknown", status: "unsupported" },
    ]);
    expect(node.status).toBe("changed");
  });

  it("keeps the presence answer when only the content is unreadable", () => {
    // Whether a side held anything is knowable even when what it held is not,
    // so an absent-to-unreadable field says `added` rather than collapsing to
    // the vaguer `changed`. This is the case a dynamic-zone type swap produces
    // when a field name is reused at a different type.
    const added = richTextNode(meta, undefined, { not: "a document" });
    expect(added.status).toBe("added");
    expect(added.blocks[0]?.status).toBe("unsupported");

    const removed = richTextNode(meta, { not: "a document" }, undefined);
    expect(removed.status).toBe("removed");

    // Both sides present and unreadable: nothing about presence separates them
    // either, so the vaguer answer is the honest one.
    const both = richTextNode(meta, { a: 1 }, { b: 2 });
    expect(both.status).toBe("changed");
  });

  it("classifies a newly populated field as added, not merely changed", () => {
    // A rich-text field that was never filled in stores null. Filling it is an
    // ADDITION, and saying so matches how text, value and source fields
    // describe the same event — "changed" would describe a change to something
    // that was not there.
    const node = richTextNode(meta, null, doc(["First"]));
    expect(node.blocks.map(b => b.status)).toEqual(["added"]);
    expect(node.status).toBe("added");
  });

  it("classifies a cleared field as removed", () => {
    const node = richTextNode(meta, doc(["First"]), null);
    expect(node.status).toBe("removed");
  });
});

describe("richTextNode — a block that arrives or leaves carrying no words", () => {
  const imageDoc = (src: string) => ({
    root: {
      type: "root",
      version: 1,
      format: "",
      indent: 0,
      direction: "ltr",
      children: [
        {
          type: "paragraph",
          version: 1,
          format: "",
          indent: 0,
          direction: "ltr",
          children: [{ type: "image", version: 1, src, altText: "" }],
        },
      ],
    },
  });

  it("says WHICH image arrived, rather than a badge over an empty row", () => {
    // A decorator holds its identity in properties, so its flattened text is
    // empty and the word comparison has nothing to show. Without the
    // properties the reader is told a picture appeared and not which one.
    const node = richTextNode(meta, doc([]), imageDoc("/hero.png"));
    const block = node.blocks[0];
    expect(block?.status).toBe("added");
    const src = (block?.attrChanges ?? []).find(c => c.name.endsWith("src"));
    expect(src).toMatchObject({ after: "/hero.png" });
  });

  it("says WHICH image left", () => {
    const node = richTextNode(meta, imageDoc("/hero.png"), doc([]));
    const block = node.blocks[0];
    expect(block?.status).toBe("removed");
    const src = (block?.attrChanges ?? []).find(c => c.name.endsWith("src"));
    expect(src).toMatchObject({ before: "/hero.png" });
  });

  it("leaves an added paragraph to its own words", () => {
    // The other direction: a block described by its text must not also list
    // every format, indent and mode its nodes carry, which would bury the
    // sentence the reader came for under a dozen rows of defaults.
    const node = richTextNode(meta, doc([]), doc(["A new sentence."]));
    expect(node.blocks[0]?.status).toBe("added");
    expect(node.blocks[0]?.attrChanges).toBeUndefined();
  });
});

describe("richTextNode — blocks that read alike", () => {
  const linked = (url: string) => ({
    type: "paragraph",
    version: 1,
    format: "",
    indent: 0,
    direction: "ltr",
    children: [
      {
        type: "link",
        version: 1,
        url,
        rel: null,
        target: null,
        children: [text("Same")],
      },
    ],
  });
  const links = (urls: string[]) => ({
    root: {
      type: "root",
      version: 1,
      format: "",
      indent: 0,
      direction: "ltr",
      children: urls.map(linked),
    },
  });

  it("pairs an inserted duplicate with itself rather than shifting its neighbours", () => {
    // All three read `Same`, so a comparison aligning on type and text alone
    // cannot tell them apart: it pairs each existing block with its
    // neighbour's link and reports two edits and an addition, none of which
    // the reader made.
    const node = richTextNode(
      meta,
      links(["/a", "/b"]),
      links(["/c", "/a", "/b"])
    );
    expect(node.blocks.map(b => b.status)).toEqual([
      "added",
      "unchanged",
      "unchanged",
    ]);
  });

  const tagged = (tag: string, value: string) => ({
    type: "heading",
    version: 1,
    tag,
    format: "",
    indent: 0,
    direction: "ltr",
    children: [text(value)],
  });
  const headed = (children: unknown[]) => ({
    root: {
      type: "root",
      version: 1,
      format: "",
      indent: 0,
      direction: "ltr",
      children,
    },
  });

  it("still pairs an attribute-only edit with its old self across an insertion", () => {
    // The control for the case above. Matching only identical blocks leaves
    // both retagged headings and the new paragraph in one unanchored stretch,
    // paired by position — which puts the second heading against the
    // paragraph. Pairing that stretch on type and text is what recovers it.
    const node = richTextNode(
      meta,
      headed([tagged("h2", "A"), tagged("h2", "B")]),
      headed([tagged("h3", "A"), para("mid"), tagged("h3", "B")])
    );
    expect(node.blocks.map(b => b.status)).toEqual([
      "changed",
      "added",
      "changed",
    ]);
  });

  it("IDEMPOTENCE: three blocks that read alike compare equal to themselves", () => {
    const same = links(["/a", "/b", "/c"]);
    expect(richTextNode(meta, same, same).status).toBe("unchanged");
  });
});
