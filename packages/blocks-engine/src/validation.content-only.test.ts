/**
 * Inside a `contentOnly` slot only content changes, judged where a save is.
 *
 * WordPress's meaning: the blocks a slot starts with keep their arrangement and
 * their design, and an author edits what they say. So each child's state other
 * than the props its block declares as content must equal the state of the
 * child it started as. Judged from the document alone, against what an insert
 * creates, because a write arriving through the API, an import or an agent
 * carries no previous version to compare with.
 *
 * Driven through the real registry and expander, for the reason the membership
 * suite is: the state a save requires is the state an insert creates.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION } from "./document";
import type { BlockDocument, BlockNode } from "./document";
import {
  clearBlocks,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
} from "./registry";
import { expandSlotDefaults, makeNode } from "./tree";
import { validateDocument } from "./validation";
import type { ValidationContext } from "./validation";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

beforeEach(() => {
  registerBlocks(
    [
      {
        ...base,
        name: "acme/headline",
        props: {
          text: { type: "text", role: "content" },
          align: { type: "select" },
        },
        defaultProps: { text: "Title", align: "left" },
      },
      {
        ...base,
        name: "acme/picture",
        props: {
          src: { type: "media", role: "content" },
          ratio: { type: "select" },
        },
        defaultProps: { src: "", ratio: "16:9" },
      },
      // Declares no content at all, so nothing about it may change.
      {
        ...base,
        name: "acme/divider",
        props: { weight: { type: "number" } },
        defaultProps: { weight: 1 },
      },
      {
        ...base,
        name: "acme/card",
        slots: {
          body: {
            defaultBlock: [
              { type: "acme/headline", props: { align: "center" } },
              { type: "acme/picture" },
              { type: "acme/divider" },
            ],
          },
        },
      },
      {
        ...base,
        name: "acme/sealed-card",
        slots: {
          body: {
            defaultBlock: [
              { type: "acme/headline", props: { align: "center" } },
              { type: "acme/picture" },
              { type: "acme/divider" },
            ],
            lock: "contentOnly",
          },
        },
      },
      {
        ...base,
        name: "acme/arranged-card",
        slots: {
          body: {
            defaultBlock: [
              { type: "acme/headline", props: { align: "center" } },
              { type: "acme/picture" },
            ],
            lock: "all",
          },
        },
      },
      // Locks a slot holding a card, whose own slot declares nothing and so
      // inherits contentOnly two levels down.
      {
        ...base,
        name: "acme/sealed-shelf",
        slots: {
          main: { defaultBlock: [{ type: "acme/card" }], lock: "contentOnly" },
        },
      },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => {
  clearBlocks();
});

/** A block as inserting it places it, with the children its slots start with. */
function placed(type: string): BlockNode {
  return makeNode(
    type,
    1,
    {},
    expandSlotDefaults(type, registryBlockSource(), registryNestingSource())
  );
}

function page(...nodes: BlockNode[]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  } as BlockDocument;
}

/** The child at `index` of a node's slot, for a test to change in place. */
function childOf(node: BlockNode, slot: string, index: number): BlockNode {
  const child = node.slots?.[slot]?.[index];
  if (child === undefined) throw new Error(`no child ${index} in "${slot}"`);
  return child;
}

function issuesOf(doc: BlockDocument, ctx: Partial<ValidationContext> = {}) {
  return validateDocument(doc, {
    breakpoints: FIXTURE_BREAKPOINTS,
    mode: "strict",
    nesting: registryNestingSource(),
    definitions: registryBlockSource(),
    ...ctx,
  }).issues;
}

/** One sealed card, with its headline (0), picture (1) and divider (2). */
function sealed() {
  const card = placed("acme/sealed-card");
  return {
    card,
    headline: childOf(card, "body", 0),
    picture: childOf(card, "body", 1),
    divider: childOf(card, "body", 2),
  };
}

describe("a contentOnly slot", () => {
  it("accepts its blocks exactly as inserting it places them", () => {
    // The positive control, against the WHOLE issue list: a rule refusing
    // every child of a contentOnly slot would satisfy each refusal below.
    expect(
      issuesOf(page(placed("acme/sealed-card"), placed("acme/sealed-shelf")))
    ).toEqual([]);
  });

  it("accepts a change to every prop its blocks declare as content", () => {
    const { card, headline, picture } = sealed();
    headline.props.text = "Spring sale";
    picture.props.src = "/media/spring.jpg";
    expect(issuesOf(page(card))).toEqual([]);
  });

  it("accepts a new layer name, which the page never draws", () => {
    const { card, headline } = sealed();
    headline.name = "Sale title";
    expect(issuesOf(page(card))).toEqual([]);
  });

  it("refuses a change to a prop that is not content, naming the slot, the rule and the prop", () => {
    const { card, headline } = sealed();
    headline.props.align = "right";
    const issues = issuesOf(page(card));
    expect(issues).toEqual([
      expect.objectContaining({
        code: "locked-slot-content-only",
        severity: "error",
        path: "/nodes/0/slots/body/0",
      }),
    ]);
    expect(issues[0]!.message).toContain('"body"');
    expect(issues[0]!.message).toContain("contentOnly");
    expect(issues[0]!.message).toContain('"align"');
  });

  it("refuses a prop that is not content being removed", () => {
    const { card, picture } = sealed();
    delete picture.props.ratio;
    expect(codesOf(issuesOf(page(card)))).toEqual(["locked-slot-content-only"]);
  });

  it("refuses any prop change on a block that declares no content", () => {
    const { card, divider } = sealed();
    divider.props.weight = 4;
    expect(codesOf(issuesOf(page(card)))).toEqual(["locked-slot-content-only"]);
  });

  it.each([
    [
      "styles",
      (n: BlockNode) => (n.styles = { base: { base: { color: "#ff0000" } } }),
    ],
    ["classes", (n: BlockNode) => (n.classes = ["promo"])],
    [
      "visibility",
      (n: BlockNode) => (n.visibility = { devices: { mobile: false } }),
    ],
    ["customCss", (n: BlockNode) => (n.customCss = "color: red;")],
    ["locked", (n: BlockNode) => (n.locked = true)],
  ])("refuses a change to its %s", (what, change) => {
    const { card, headline } = sealed();
    change(headline);
    const issues = issuesOf(page(card));
    expect(codesOf(issues)).toEqual(["locked-slot-content-only"]);
    expect(issues[0]!.message).toContain(what);
  });

  it("accepts a binding on a content prop, and refuses one on any other", () => {
    const content = sealed();
    content.headline.bindings = { text: { $bind: "title" } };
    expect(issuesOf(page(content.card))).toEqual([]);

    const design = sealed();
    design.headline.bindings = { align: { $bind: "side" } };
    expect(codesOf(issuesOf(page(design.card)))).toEqual([
      "locked-slot-content-only",
    ]);
  });

  it("holds every level beneath it, through a slot that declares no lock", () => {
    const shelf = placed("acme/sealed-shelf");
    const card = childOf(shelf, "main", 0);
    childOf(card, "body", 0).props.align = "right";
    const issues = issuesOf(page(shelf));
    expect(issues).toEqual([
      expect.objectContaining({
        code: "locked-slot-content-only",
        path: "/nodes/0/slots/main/0/slots/body/0",
      }),
    ]);
  });

  it("refuses in forgiving mode too, because a lock is not a value to preserve", () => {
    const { card, headline } = sealed();
    headline.props.align = "right";
    expect(codesOf(issuesOf(page(card), { mode: "forgiving" }))).toEqual([
      "locked-slot-content-only",
    ]);
  });
});

describe("a slot locked all", () => {
  it("keeps its blocks' content and design editable", () => {
    const card = placed("acme/arranged-card");
    const headline = childOf(card, "body", 0);
    headline.props.align = "right";
    headline.styles = { base: { base: { color: "#ff0000" } } };
    headline.classes = ["promo"];
    expect(issuesOf(page(card))).toEqual([]);
  });
});

describe("a slot with no lock", () => {
  it("lets its blocks' design change", () => {
    const card = placed("acme/card");
    childOf(card, "body", 0).props.align = "right";
    expect(issuesOf(page(card))).toEqual([]);
  });
});

function codesOf(issues: readonly { code: string }[]): string[] {
  return issues.map(issue => issue.code);
}
