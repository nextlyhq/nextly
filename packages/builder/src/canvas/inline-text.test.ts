/**
 * Which values a canvas may let an author type into, and what a finished edit
 * writes.
 *
 * Driven through the real registry, because "the block declares it" is the
 * whole rule — a stub restating which props are inline would be the second
 * answer this module exists to avoid.
 *
 * @module inline-text.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearBlocks,
  registerBlocks,
  RICH_TEXT_PROP_TYPE,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { inlineTarget, inlineTargets, inlineTextOp } from "./inline-text";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

afterEach(clearBlocks);

function documentOf(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

/** A block declaring one inline value, one multiline one, and two that are not. */
function withQuote(
  props: Record<string, unknown> = {},
  node: Partial<BlockNode> = {}
) {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/quote",
        props: {
          text: { type: "textarea", inline: true },
          source: { type: "text", inline: true },
          attribution: { type: "text" },
          citeUrl: { type: "url" },
        },
      },
    ] as never,
    { source: "inline-text-test" }
  );
  return documentOf([
    { id: "a", type: "acme/quote", version: 1, props, ...node } as BlockNode,
  ]);
}

/** A block whose inline value is a TREE rather than a line of text. */
function withPassage(props: Record<string, unknown> = {}) {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/passage",
        props: {
          content: { type: RICH_TEXT_PROP_TYPE, inline: true },
          caption: { type: "text", inline: true },
        },
      },
    ] as never,
    { source: "inline-text-test" }
  );
  return documentOf([
    { id: "a", type: "acme/passage", version: 1, props } as BlockNode,
  ]);
}

describe("inlineTargets", () => {
  it("refuses a value whose type is a tree, however it was declared", () => {
    /*
     * The `inline` flag alone would offer this, and everything downstream reads
     * a value as text and writes a string back — so the caret would land in an
     * empty element and clicking away would commit "" over the whole passage.
     * The author loses the work by looking at it, and nothing reports an error.
     *
     * `caption` is in the same block and IS offered, which is what separates
     * this from a rule that refuses any block holding rich text.
     */
    const stored = {
      content: { root: { type: "root", children: [] } },
      caption: "A caption",
    };
    const targets = inlineTargets(withPassage(stored), "a");

    expect(targets.map(t => t.prop)).toEqual(["caption"]);
  });

  it("refuses it while it is EMPTY too", () => {
    // Decided from the declared type, not from what the prop happens to hold.
    // Read from the value, a passage an author had not written yet would be
    // offered as text — and the first edit would store a string where every
    // reader expects a tree.
    const targets = inlineTargets(withPassage({ caption: "A caption" }), "a");

    expect(targets.map(t => t.prop)).toEqual(["caption"]);
  });

  it("offers only the values the block declared inline", () => {
    // `attribution` and `citeUrl` are real props with schemas and no `inline`,
    // so a canvas must not offer them: nothing marked their element, and an
    // author double-clicking one would find text that never becomes editable.
    const targets = inlineTargets(withQuote({ text: "Hi" }), "a");

    expect(targets.map(t => t.prop)).toEqual(["text", "source"]);
  });

  it("reads whether a value may hold line breaks from its schema", () => {
    // What decides where Enter goes. Kept as a derivation rather than a list of
    // prop names here, so a block changing a field from one type to the other
    // changes this with it.
    const targets = inlineTargets(withQuote(), "a");

    expect(targets.find(t => t.prop === "text")?.multiline).toBe(true);
    expect(targets.find(t => t.prop === "source")?.multiline).toBe(false);
  });

  it("carries the stored value, and reads a non-string as empty", () => {
    // A stored document holds whatever a migration or an import left there.
    // Putting `[object Object]` into an editable element would let an author
    // "keep" a value they never typed.
    const targets = inlineTargets(
      withQuote({ text: { nope: 1 }, source: "S" }),
      "a"
    );

    expect(targets.find(t => t.prop === "text")?.value).toBe("");
    expect(targets.find(t => t.prop === "source")?.value).toBe("S");
  });

  it("offers nothing for a LOCKED block", () => {
    // A lock has to be honoured at every entry point or it is honoured at none,
    // which is the state where an author believes a block is protected.
    const locked = inlineTargets(
      withQuote({ text: "Hi" }, { locked: true }),
      "a"
    );

    expect(locked).toEqual([]);
  });

  it("still offers them when the block is not locked, which is the control", () => {
    // Without this, the case above passes on a module that offers nothing under
    // any circumstances.
    expect(
      inlineTargets(withQuote({ text: "Hi" }), "a").length
    ).toBeGreaterThan(0);
  });

  it("offers nothing for a node whose type is not registered", () => {
    const document = documentOf([
      { id: "a", type: "acme/absent", version: 1, props: {} } as BlockNode,
    ]);

    expect(inlineTargets(document, "a")).toEqual([]);
  });

  it("offers nothing for a node that is not there", () => {
    expect(inlineTargets(withQuote(), "missing")).toEqual([]);
  });
});

describe("inlineTarget", () => {
  it("answers for one named value", () => {
    expect(inlineTarget(withQuote({ source: "S" }), "a", "source")?.value).toBe(
      "S"
    );
  });

  it("refuses a prop the block did not declare inline", () => {
    expect(inlineTarget(withQuote(), "a", "attribution")).toBeNull();
  });
});

describe("inlineTextOp", () => {
  it("writes the new text as one update", () => {
    const document = withQuote({ text: "before", source: "S" });

    const op = inlineTextOp(document, "a", "text", "after");

    expect(op).toEqual({
      kind: "update",
      id: "a",
      // The whole props record, because that is what a patch replaces — the
      // sibling value has to survive the edit.
      patch: { props: { text: "after", source: "S" } },
    });
  });

  it("writes NOTHING when the text did not change", () => {
    // An author who enters an edit and leaves without typing has made no edit.
    // Recording one would put an entry on the undo stack that appears to do
    // nothing, which reads as the history being broken.
    const document = withQuote({ text: "same" });

    expect(inlineTextOp(document, "a", "text", "same")).toBeNull();
  });

  it("writes an op when the text DID change, which is the control", () => {
    const document = withQuote({ text: "same" });

    expect(inlineTextOp(document, "a", "text", "different")).not.toBeNull();
  });

  it("writes nothing when the block was locked while the edit was open", () => {
    // The document is read as it stands NOW, not as it stood when the caret
    // went in — a block can be locked from the layers panel mid-edit.
    const document = withQuote({ text: "before" }, { locked: true });

    expect(inlineTextOp(document, "a", "text", "after")).toBeNull();
  });

  it("writes nothing when the node was deleted while the edit was open", () => {
    expect(
      inlineTextOp(withQuote({ text: "x" }), "gone", "text", "after")
    ).toBeNull();
  });

  it("stores an emptied value rather than removing the prop", () => {
    // An empty string is a value an author chose. Unsetting the prop would fall
    // back to the block's default, which is how clearing a heading puts the
    // placeholder text back and reads as the edit being rejected.
    const document = withQuote({ text: "something" });

    expect(inlineTextOp(document, "a", "text", "")).toEqual({
      kind: "update",
      id: "a",
      patch: { props: { text: "" } },
    });
  });
});
