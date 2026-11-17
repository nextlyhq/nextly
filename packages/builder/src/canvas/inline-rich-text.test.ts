/**
 * Which passages a canvas may let an author edit, and what a finished edit
 * writes.
 *
 * Driven through the real registry, because "the block declares it" is the
 * whole rule — a stub restating which props are rich would be the second answer
 * these modules exist to avoid.
 *
 * @module inline-rich-text.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearBlocks,
  registerBlocks,
  RICH_TEXT_PROP_TYPE,
  type BlockDocument,
  type BlockNode,
  type RichTextValue,
} from "@nextlyhq/blocks-engine";

import { inlinePropKind } from "./inline-prop-kind";
import {
  richInlineTarget,
  richInlineTargets,
  richInlineTextOp,
  richTextChanged,
  richTextMovedOn,
} from "./inline-rich-text";

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

/** A block with one passage, one line of text, and one prop editable nowhere. */
function withArticle(
  props: Record<string, unknown> = {},
  node: Partial<BlockNode> = {}
) {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/article",
        props: {
          content: { type: RICH_TEXT_PROP_TYPE, inline: true },
          caption: { type: "text", inline: true },
          href: { type: "url" },
        },
      },
    ] as never,
    { source: "inline-rich-text-test" }
  );
  return documentOf([
    { id: "a", type: "acme/article", version: 1, props, ...node } as BlockNode,
  ]);
}

function passage(text: string): RichTextValue {
  return {
    root: {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", text, format: 0 }] },
      ],
    },
  };
}

describe("inlinePropKind", () => {
  it("separates the two surfaces from ONE answer", () => {
    // The whole point of the classifier. Two predicates would agree today and
    // be one edit apart from both claiming a value, or neither claiming it.
    expect(inlinePropKind({ type: RICH_TEXT_PROP_TYPE, inline: true })).toBe(
      "rich"
    );
    expect(inlinePropKind({ type: "textarea", inline: true })).toBe("plain");
  });

  it("refuses a prop that never opted in, however it is typed", () => {
    // A rich prop without `inline` is edited in the inspector, not the canvas.
    expect(inlinePropKind({ type: RICH_TEXT_PROP_TYPE })).toBeNull();
    expect(inlinePropKind({ type: "text" })).toBeNull();
    expect(inlinePropKind(undefined)).toBeNull();
  });
});

describe("richInlineTargets", () => {
  it("offers only the passages, never the plain values beside them", () => {
    // `caption` is inline and IS editable — by the other surface. Offering it
    // here would hand a string to an editor that reads back a tree.
    const targets = richInlineTargets(
      withArticle({ content: passage("Hi") }),
      "a"
    );

    expect(targets.map(t => t.prop)).toEqual(["content"]);
  });

  it("offers a passage the document holds nothing usable for", () => {
    // The prop is what makes it editable, not its current contents. Refusing an
    // empty one would leave a newly inserted block impossible to type into.
    const targets = richInlineTargets(withArticle({}), "a");

    expect(targets.map(t => t.prop)).toEqual(["content"]);
    expect(targets[0]?.value).toBeUndefined();
  });

  it("reports a stored value that is not rich text as absent", () => {
    // A string left by a document written before the prop was rich. Handing it
    // to the editor as if it were a tree is what the narrowing prevents.
    const targets = richInlineTargets(withArticle({ content: "plain" }), "a");

    expect(targets[0]?.value).toBeUndefined();
  });

  it("offers nothing on a LOCKED block", () => {
    // A lock is honoured at every entry point or it is honoured at none, which
    // is the state where an author believes a block is protected.
    const document = withArticle({ content: passage("Hi") }, { locked: true });

    expect(richInlineTargets(document, "a")).toEqual([]);
  });
});

describe("richTextChanged", () => {
  it("reports an untouched passage as unchanged", () => {
    expect(richTextChanged(passage("Hi"), passage("Hi"))).toBe(false);
  });

  it("reports an edited one as changed", () => {
    expect(richTextChanged(passage("Hi"), passage("Ho"))).toBe(true);
  });
});

describe("richInlineTextOp", () => {
  it("writes the passage the editor produced", () => {
    const document = withArticle({ content: passage("Before") });
    const op = richInlineTextOp(
      document,
      "a",
      "content",
      passage("After"),
      passage("Before"),
      passage("Before")
    );

    expect(op).not.toBeNull();
    expect(JSON.stringify(op)).toContain("After");
  });

  it("writes NOTHING when the author typed nothing", () => {
    /*
     * Compared against what the editor read when the passage OPENED, not
     * against what the document stores. An editor normalises what it loads, so
     * a passage merely opened and closed differs from the stored value by
     * fields the author never saw — and recording that would put an entry on
     * the undo stack that appears to do nothing.
     */
    const stored = passage("Same");
    const normalised = {
      root: {
        ...stored.root,
        format: "",
        indent: 0,
        version: 1,
        direction: null,
      },
    } as unknown as RichTextValue;
    const document = withArticle({ content: stored });

    expect(
      richInlineTextOp(document, "a", "content", normalised, normalised, stored)
    ).toBeNull();
  });

  it("refuses a value the editor did not return as a passage", () => {
    // Storing it would put a shape into the document that every reader of the
    // format would then have to survive.
    const document = withArticle({ content: passage("Before") });

    expect(
      richInlineTextOp(
        document,
        "a",
        "content",
        "just a string",
        passage("Before"),
        passage("Before")
      )
    ).toBeNull();
  });

  it("refuses a passage that stopped being editable while the caret was in it", () => {
    // The node can be locked from the layers panel, a keyboard action, or
    // another surface entirely, after the edit began.
    const document = withArticle(
      { content: passage("Before") },
      { locked: true }
    );

    expect(
      richInlineTextOp(
        document,
        "a",
        "content",
        passage("After"),
        passage("Before"),
        passage("Before")
      )
    ).toBeNull();
  });
});

describe("richInlineTarget", () => {
  it("answers the same way as the list it derives from", () => {
    const document = withArticle({ content: passage("Hi") });

    expect(richInlineTarget(document, "a", "content")?.prop).toBe("content");
    // The plain value, asked of the rich surface.
    expect(richInlineTarget(document, "a", "caption")).toBeNull();
  });
});

describe("a passage the document changed underneath the caret", () => {
  it("refuses the write rather than patching over the newer value", () => {
    /*
     * Another builder surface, an undo, or an op applied from anywhere else can
     * rewrite the same prop while a caret is open. The editor is holding a copy
     * taken before that, so writing it back replaces the newer passage with the
     * older one and the intervening change is gone with nothing raised.
     *
     * Refusing loses the author's own edit instead — which is the one still on
     * their screen, and the one they can repeat.
     */
    const document = withArticle({ content: passage("CHANGED ELSEWHERE") });

    expect(
      richInlineTextOp(
        document,
        "a",
        "content",
        passage("What I typed"),
        passage("What I opened"),
        passage("What I opened")
      )
    ).toBeNull();
  });

  it("still writes when the stored passage is the one the session opened", () => {
    // The control. A comparison that never matched would refuse every commit,
    // which passes the case above while making inline editing write nothing.
    const document = withArticle({ content: passage("What I opened") });

    expect(
      richInlineTextOp(
        document,
        "a",
        "content",
        passage("What I typed"),
        passage("What I opened"),
        passage("What I opened")
      )
    ).not.toBeNull();
  });
});

describe("two stored values that are both unusable", () => {
  it("sees a value arrive where the session found nothing", () => {
    /*
     * The case the narrowed comparison cannot answer. Everything unusable reads
     * as `undefined` once narrowed, so a session that opened on an ABSENT
     * passage compares its `undefined` against the narrowed form of whatever is
     * there now — also `undefined` — and reports no change. The edit then
     * overwrites a value another surface stored while the caret was open.
     *
     * Comparing raw against raw keeps them distinct: nothing is not a string.
     */
    const document = withArticle({ content: "stored by someone else" });

    expect(richTextMovedOn(document, "a", "content", undefined)).toBe(true);
  });

  it("reports no move when the raw value is the one that was opened", () => {
    // The control: a comparison that always reported a move would refuse every
    // commit, which passes the case above while writing nothing ever again.
    const document = withArticle({ content: "A" });

    expect(richTextMovedOn(document, "a", "content", "A")).toBe(false);
  });

  it("says a passage that stopped being editable has not MOVED", () => {
    // A lock is refused by the write for its own reason. Reporting it as a move
    // would keep the edit open forever on a block that can never accept it.
    const document = withArticle({ content: passage("Hi") }, { locked: true });

    expect(richTextMovedOn(document, "a", "content", passage("Hi"))).toBe(
      false
    );
  });
});
