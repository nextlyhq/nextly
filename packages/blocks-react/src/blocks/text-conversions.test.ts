/**
 * "Turn into" between Text, Rich text and Heading: every pair, planned through
 * the engine's "Turn into" with the blocks' own definitions, so what is tested
 * is what the editor applies.
 *
 * Each pair pins what the words become and what is said to be lost; the last
 * group pins what a turned block keeps whatever its type, and that the turn is
 * one undo step.
 */
import {
  type AnyBlockDefinition,
  applyOp,
  DOCUMENT_FORMAT_VERSION,
  planTurnInto,
  TEXT_FORMAT,
  turnIntoTargets,
  type BlockDocument,
  type BlockNode,
  type RichTextNode,
  type RichTextValue,
  type TurnIntoPlan,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { heading } from "./heading";
import { paragraph } from "./paragraph";
import { richText } from "./rich-text";
import {
  HEADING_BLOCK,
  RICH_TEXT_BLOCK,
  TEXT_BLOCK,
  TURN_INTO_WORDS,
} from "./text-conversions";

const DEFINITIONS = new Map<string, AnyBlockDefinition>(
  [paragraph, richText, heading].map(each => [
    each.name,
    each as unknown as AnyBlockDefinition,
  ])
);
const lookup = (name: string) => DEFINITIONS.get(name);

const words = (text: string, format = 0): RichTextNode => ({
  type: "text",
  text,
  format,
});
const link = (url: string, children: RichTextNode[]): RichTextNode => ({
  type: "link",
  url,
  children,
});
const root = (...children: RichTextNode[]): RichTextValue => ({
  root: { type: "root", children },
});
const para = (...children: RichTextNode[]): RichTextNode => ({
  type: "paragraph",
  children,
});

/** "Read the bold news here.", with "bold" bold and "here" a link. */
const MARKED = root(
  para(
    words("Read the "),
    words("bold", TEXT_FORMAT.BOLD),
    words(" news "),
    link("https://example.com", [words("here")]),
    words(".")
  )
);

function block(type: string, props: Record<string, unknown>): BlockNode {
  const version = DEFINITIONS.get(type)?.version ?? 1;
  return { id: "b1", type, version, props };
}

function page(node: BlockNode): BlockDocument {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes: [node] };
}

function turn(node: BlockNode, to: string): TurnIntoPlan {
  const plan = planTurnInto(page(node), node.id, to, lookup);
  if ("refused" in plan) throw new Error(`refused: ${plan.refused}`);
  return plan;
}

function refusal(node: BlockNode, to: string): string | undefined {
  const plan = planTurnInto(page(node), node.id, to, lookup);
  return "refused" in plan ? plan.refused : undefined;
}

describe("what each block offers", () => {
  it("Text offers Rich text and Heading; Rich text offers Text and Heading; Heading offers Text and Rich text", () => {
    expect(turnIntoTargets(TEXT_BLOCK, lookup)).toEqual([
      RICH_TEXT_BLOCK,
      HEADING_BLOCK,
    ]);
    expect(turnIntoTargets(RICH_TEXT_BLOCK, lookup)).toEqual([
      TEXT_BLOCK,
      HEADING_BLOCK,
    ]);
    expect(turnIntoTargets(HEADING_BLOCK, lookup)).toEqual([
      TEXT_BLOCK,
      RICH_TEXT_BLOCK,
    ]);
  });
});

describe("Text → Rich text", () => {
  it("keeps the words, bold and the link, and says nothing is lost", () => {
    const plan = turn(block(TEXT_BLOCK, { text: MARKED }), RICH_TEXT_BLOCK);
    expect(plan.op.node.type).toBe(RICH_TEXT_BLOCK);
    expect(plan.op.node.props).toEqual({ content: MARKED });
    expect(plan.dropped).toBeUndefined();
  });

  it("reads a Text stored as a plain string as its paragraph", () => {
    const plan = turn(block(TEXT_BLOCK, { text: "One\nTwo" }), RICH_TEXT_BLOCK);
    expect(plan.op.node.props).toEqual({
      content: root(para(words("One"), { type: "linebreak" }, words("Two"))),
    });
  });
});

describe("Text → Heading", () => {
  it("keeps the words and says bold and links are removed", () => {
    const plan = turn(block(TEXT_BLOCK, { text: MARKED }), HEADING_BLOCK);
    expect(plan.op.node.props).toEqual({
      text: "Read the bold news here.",
      level: "h2",
    });
    expect(plan.dropped).toBe("Bold and links are removed");
  });

  it("says nothing is lost for plain words, and puts a line break's words on one line", () => {
    const plan = turn(block(TEXT_BLOCK, { text: "One\nTwo" }), HEADING_BLOCK);
    expect(plan.op.node.props).toEqual({ text: "One Two", level: "h2" });
    expect(plan.dropped).toBeUndefined();
  });
});

describe("Rich text → Heading", () => {
  it("keeps one paragraph's words and says bold and links are removed", () => {
    const plan = turn(block(RICH_TEXT_BLOCK, { content: MARKED }), HEADING_BLOCK);
    expect(plan.op.node.props).toEqual({
      text: "Read the bold news here.",
      level: "h2",
    });
    expect(plan.dropped).toBe(TURN_INTO_WORDS.marksRemoved);
  });

  it("keeps one heading's words and its level", () => {
    const content = root({
      type: "heading",
      tag: "h3",
      children: [words("Our team")],
    });
    const plan = turn(block(RICH_TEXT_BLOCK, { content }), HEADING_BLOCK);
    expect(plan.op.node.props).toEqual({ text: "Our team", level: "h3" });
    expect(plan.dropped).toBeUndefined();
  });

  it("is not offered for two paragraphs, and says why", () => {
    const content = root(para(words("One")), para(words("Two")));
    expect(refusal(block(RICH_TEXT_BLOCK, { content }), HEADING_BLOCK)).toBe(
      "Only a Rich text with one paragraph or one heading can become a Heading."
    );
  });
});

describe("Rich text → Text", () => {
  it("keeps one paragraph with its bold and its link", () => {
    const plan = turn(block(RICH_TEXT_BLOCK, { content: MARKED }), TEXT_BLOCK);
    expect(plan.op.node.props).toEqual({ text: MARKED });
    expect(plan.dropped).toBeUndefined();
  });

  it("turns one heading into a paragraph of its words", () => {
    const content = root({
      type: "heading",
      tag: "h2",
      children: [words("Our "), words("team", TEXT_FORMAT.ITALIC)],
    });
    const plan = turn(block(RICH_TEXT_BLOCK, { content }), TEXT_BLOCK);
    expect(plan.op.node.props).toEqual({
      text: root(para(words("Our "), words("team", TEXT_FORMAT.ITALIC))),
    });
    expect(plan.dropped).toBeUndefined();
  });

  it("says what a Text cannot hold is removed: only bold, italic and links are kept", () => {
    const content = root(para(words("Under", TEXT_FORMAT.UNDERLINE)));
    const plan = turn(block(RICH_TEXT_BLOCK, { content }), TEXT_BLOCK);
    expect(plan.op.node.props).toEqual({ text: root(para(words("Under"))) });
    expect(plan.dropped).toBe("Only bold, italic and links are kept");
  });

  it("is not offered for two paragraphs or a list, and says why", () => {
    const two = root(para(words("One")), para(words("Two")));
    const list = root({
      type: "list",
      listType: "bullet",
      children: [{ type: "listitem", children: [words("Item")] }],
    });
    for (const content of [two, list]) {
      expect(refusal(block(RICH_TEXT_BLOCK, { content }), TEXT_BLOCK)).toBe(
        "Only a Rich text with one paragraph or one heading can become Text."
      );
    }
  });

  it("is offered again once only one paragraph is left", () => {
    const content = root(para(words("One")));
    expect(
      refusal(block(RICH_TEXT_BLOCK, { content }), TEXT_BLOCK)
    ).toBeUndefined();
    expect(
      refusal(block(RICH_TEXT_BLOCK, { content }), HEADING_BLOCK)
    ).toBeUndefined();
  });
});

describe("Heading → Text and Rich text", () => {
  const HEADING_PROPS = { text: "Our team", level: "h3" };

  it("Text keeps the words", () => {
    const plan = turn(block(HEADING_BLOCK, HEADING_PROPS), TEXT_BLOCK);
    expect(plan.op.node.props).toEqual({ text: root(para(words("Our team"))) });
    expect(plan.dropped).toBeUndefined();
  });

  it("Rich text keeps the words as a heading of the same level", () => {
    const plan = turn(block(HEADING_BLOCK, HEADING_PROPS), RICH_TEXT_BLOCK);
    expect(plan.op.node.props).toEqual({
      content: root({ type: "heading", tag: "h3", children: [words("Our team")] }),
    });
  });

  it("keeps a link to an address around the words", () => {
    const props = {
      ...HEADING_PROPS,
      href: "https://example.com/team",
      target: "_blank",
    };
    const plan = turn(block(HEADING_BLOCK, props), TEXT_BLOCK);
    expect(plan.op.node.props).toEqual({
      text: root(
        para({
          type: "link",
          url: "https://example.com/team",
          target: "_blank",
          children: [words("Our team")],
        })
      ),
    });
    expect(plan.dropped).toBeUndefined();
  });

  it("removes a link to an entry, which a Text cannot hold, and says so", () => {
    const props = {
      ...HEADING_PROPS,
      entryCollection: "people",
      entryId: "p1",
    };
    for (const to of [TEXT_BLOCK, RICH_TEXT_BLOCK]) {
      const plan = turn(block(HEADING_BLOCK, props), to);
      expect(JSON.stringify(plan.op.node.props)).not.toContain('"link"');
      expect(plan.dropped).toBe("The link is removed");
    }
  });
});

describe("what a turned block keeps", () => {
  /** A Text with every setting "Turn into" carries over. */
  const DRESSED: BlockNode = {
    id: "t1",
    type: TEXT_BLOCK,
    version: 2,
    props: { text: MARKED },
    name: "Intro",
    styles: { base: { desktop: { color: "#c00", fontSize: "1.25rem" } } },
    classes: ["look-text-lead", "shared-brand"],
    visibility: {
      devices: { mobile: false },
      conditions: [[{ field: "status", op: "eq", value: "vip" }]],
    },
  };

  it("keeps the id, name, styles, block style, shared styles, visibility and conditions", () => {
    for (const to of [RICH_TEXT_BLOCK, HEADING_BLOCK]) {
      const { op } = turn(DRESSED, to);
      expect(op.node).toMatchObject({
        id: "t1",
        type: to,
        name: "Intro",
        styles: DRESSED.styles,
        classes: DRESSED.classes,
        visibility: DRESSED.visibility,
      });
    }
  });

  it("keeps a binding to words where the new block shows words, and removes it where it cannot", () => {
    const bound: BlockNode = { ...DRESSED, bindings: { text: { $bind: "title" } } };
    const toHeading = turn(bound, HEADING_BLOCK);
    expect(toHeading.op.node.bindings).toEqual({ text: { $bind: "title" } });
    expect(toHeading.unbound).toEqual([]);

    const toRichText = turn(bound, RICH_TEXT_BLOCK);
    expect(toRichText.op.node.bindings).toBeUndefined();
    expect(toRichText.unbound).toEqual(["text"]);

    const back = turn(
      { ...toHeading.op.node, version: 1 },
      TEXT_BLOCK
    );
    expect(back.op.node.bindings).toEqual({ text: { $bind: "title" } });
  });

  it("is one undo step that gives the Text back exactly", () => {
    const before = page(DRESSED);
    const { op } = turn(DRESSED, RICH_TEXT_BLOCK);
    const applied = applyOp(before, op);
    expect(applied.document.nodes[0]?.type).toBe(RICH_TEXT_BLOCK);
    expect(applyOp(applied.document, applied.inverse).document).toEqual(before);
  });

  it("turns a Text into Rich text and back with nothing lost", () => {
    const there = turn(DRESSED, RICH_TEXT_BLOCK).op.node;
    const back = turn(there, TEXT_BLOCK);
    expect(back.op.node).toEqual(DRESSED);
    expect(back.dropped).toBeUndefined();
  });
});
