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

describe("richTextNode — what it cannot compare", () => {
  it("forces the FIELD to changed when a block is unsupported", () => {
    // Both sides identical, so a text comparison alone would say unchanged —
    // and `modifiedOnly` would then drop the field and the refusal with it.
    const bare = {
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
            children: [{ type: "gallery", version: 1 }],
          },
        ],
      },
    };
    const node = richTextNode(meta, bare, bare);
    expect(node.blocks[0]?.status).toBe("unsupported");
    expect(node.status).toBe("changed");
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

  it("treats a null side as an empty document rather than refusing", () => {
    // A rich-text field that was never filled in stores null. That is an
    // absence with a known meaning, not something unreadable, so adding the
    // first paragraph must read as an addition rather than as a refusal.
    const node = richTextNode(meta, null, doc(["First"]));
    expect(node.blocks.map(b => b.status)).toEqual(["added"]);
    expect(node.status).toBe("changed");
  });
});
