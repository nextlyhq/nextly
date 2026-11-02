/**
 * The core library judged by the one placement rule, pair by pair.
 *
 * The expected table below is the HTML content model the editor's spec names,
 * written out per block and setting, NOT read back from the blocks: a test
 * that asked each block what it is and then expected that answer would pass
 * whatever the blocks declared. The name rules (`parent`, `allow`) come from
 * the definitions on purpose — `nesting.test.ts` owns those — so a pair is
 * expected to be refused by name exactly when the definitions say so.
 */
import {
  canNest,
  canNestInSlot,
  canPlace,
  clearBlocks,
  registerBlocks,
  registryBlockSource,
  registryNestingSource,
  type BlockNode,
  type ContentKind,
  type PlacementSources,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { box } from "./box";
import { card } from "./card";
import { LINKABLE_BASE_STYLE } from "./container";
import { coreBlocks } from "./index";

beforeAll(() => {
  clearBlocks();
  registerBlocks(coreBlocks as never, { source: "core" });
});

afterAll(() => {
  clearBlocks();
});

function sources(): PlacementSources {
  return {
    nesting: registryNestingSource(),
    definitions: registryBlockSource(),
  };
}

/** A paragraph of rich text holding one link. */
const LINKED_PASSAGE = {
  root: {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            url: "https://example.com",
            children: [{ type: "text", text: "Read on" }],
          },
        ],
      },
    ],
  },
};

/**
 * Every core block with its default props, plus each setting that changes
 * what it renders, and what HTML makes each one: the kinds it IS and the kinds
 * it refuses anywhere beneath it.
 */
interface Variant {
  readonly name: string;
  readonly type: string;
  readonly props: Record<string, unknown>;
  readonly is: readonly ContentKind[];
  readonly without: readonly ContentKind[];
}

const FLOW = { is: ["flow"], without: [] } as const;
const SECTIONING = { is: ["flow"], without: ["main"] } as const;
const LINKED = {
  is: ["flow", "interactive"],
  without: ["interactive", "main"],
} as const;

const VARIANTS: readonly Variant[] = [
  {
    name: "Section",
    type: "core/section",
    props: { as: "section" },
    ...SECTIONING,
  },
  {
    name: "Section as header",
    type: "core/section",
    props: { as: "header" },
    is: ["flow", "header"],
    without: ["header", "footer", "main"],
  },
  {
    name: "Section as footer",
    type: "core/section",
    props: { as: "footer" },
    is: ["flow", "footer"],
    without: ["header", "footer", "main"],
  },
  {
    name: "Section as main",
    type: "core/section",
    props: { as: "main" },
    is: ["flow", "main"],
    without: ["main"],
  },
  { name: "Box", type: "core/box", props: { as: "div" }, ...FLOW },
  {
    name: "Box as article",
    type: "core/box",
    props: { as: "article" },
    ...SECTIONING,
  },
  {
    name: "Linked box",
    type: "core/box",
    props: { as: "div", link: "/go" },
    ...LINKED,
  },
  { name: "Card", type: "core/card", props: { as: "div" }, ...FLOW },
  {
    name: "Linked card",
    type: "core/card",
    props: { as: "div", link: "/go" },
    ...LINKED,
  },
  {
    name: "Card with an unusable link",
    type: "core/card",
    props: { as: "div", link: "javascript:alert(1)" },
    ...FLOW,
  },
  { name: "Columns", type: "core/columns", props: { as: "div" }, ...FLOW },
  { name: "Column", type: "core/column", props: { as: "div" }, ...FLOW },
  { name: "Gallery", type: "core/gallery", props: { as: "div" }, ...FLOW },
  { name: "Accordion", type: "core/accordion", props: { as: "div" }, ...FLOW },
  {
    name: "Accordion item",
    type: "core/accordion-item",
    props: { title: "Q" },
    is: ["flow", "interactive"],
    without: ["main"],
  },
  { name: "Collection loop", type: "core/collection-loop", props: {}, ...FLOW },
  { name: "Spacer", type: "core/spacer", props: {}, ...FLOW },
  { name: "Heading", type: "core/heading", props: { text: "Hi" }, ...FLOW },
  {
    name: "Linked heading",
    type: "core/heading",
    props: { text: "Hi", href: "/go" },
    is: ["flow", "interactive"],
    without: [],
  },
  { name: "Text", type: "core/text", props: { text: "Hi" }, ...FLOW },
  { name: "Rich text", type: "core/rich-text", props: {}, ...FLOW },
  {
    name: "Rich text holding a link",
    type: "core/rich-text",
    props: { content: LINKED_PASSAGE },
    is: ["flow", "interactive"],
    without: [],
  },
  {
    name: "Rich text holding an unusable link",
    type: "core/rich-text",
    props: {
      content: {
        root: {
          type: "root",
          children: [
            {
              type: "paragraph",
              children: [
                {
                  type: "link",
                  url: "javascript:alert(1)",
                  children: [{ type: "text", text: "Read on" }],
                },
              ],
            },
          ],
        },
      },
    },
    ...FLOW,
  },
  {
    name: "Embed with nothing to embed",
    type: "core/embed",
    props: {},
    is: [],
    without: [],
  },
  { name: "List", type: "core/list", props: { items: ["a"] }, ...FLOW },
  {
    name: "Image",
    type: "core/image",
    props: { src: "/a.png", alt: "" },
    ...FLOW,
  },
  {
    name: "Button",
    type: "core/button",
    props: { label: "Go", href: "/go" },
    is: ["flow", "phrasing", "interactive"],
    without: [],
  },
  {
    name: "Form",
    type: "core/form",
    props: {},
    is: ["flow", "form", "interactive"],
    without: [],
  },
  { name: "Divider", type: "core/divider", props: {}, ...FLOW },
  { name: "Quote", type: "core/quote", props: { text: "Hi" }, ...FLOW },
  {
    name: "Embed",
    type: "core/embed",
    props: { src: "https://example.com", title: "x" },
    is: ["flow", "interactive"],
    without: [],
  },
];

let next = 0;
const node = (variant: Variant): BlockNode => {
  next += 1;
  return {
    id: `n${next}`,
    type: variant.type,
    version: 1,
    props: variant.props,
  };
};

describe("the variants cover the core library", () => {
  it("names every core block at least once", () => {
    const covered = new Set(VARIANTS.map(variant => variant.type));
    expect(
      coreBlocks.map(block => block.name).filter(name => !covered.has(name))
    ).toEqual([]);
  });
});

describe("every pair of core blocks", () => {
  for (const parent of VARIANTS) {
    const slots = Object.keys(
      coreBlocks.find(block => block.name === parent.type)?.slots ?? {}
    );
    for (const child of VARIANTS) {
      it(`${child.name} into ${parent.name}`, () => {
        const verdict = canPlace(
          [node(child)],
          {
            kind: "slot",
            parent: node(parent),
            slot: slots[0] ?? "children",
            inherited: [],
          },
          sources()
        );
        if (slots.length === 0) {
          expect(verdict).toMatchObject({
            allowed: false,
            reason: "holds-no-blocks",
          });
          return;
        }
        const nesting = registryNestingSource();
        const byName = canNest(child.type, parent.type, nesting);
        const bySlot = canNestInSlot(
          child.type,
          parent.type,
          slots[0] ?? "",
          nesting
        );
        if (!byName.allowed || !bySlot.allowed) {
          expect(verdict).toMatchObject({
            allowed: false,
            reason: byName.allowed ? bySlot.reason : byName.reason,
          });
          return;
        }
        const clash = child.is.find(kind => parent.without.includes(kind));
        expect(verdict).toEqual(
          clash === undefined
            ? { allowed: true }
            : expect.objectContaining({
                allowed: false,
                reason: "content-model",
                kind: clash,
              })
        );
      });
    }
  }
});

describe("the cases the spec names", () => {
  const find = (name: string) => {
    const variant = VARIANTS.find(entry => entry.name === name);
    if (variant === undefined) throw new Error(`no variant ${name}`);
    return variant;
  };
  const judge = (child: string, parent: string) =>
    canPlace(
      [node(find(child))],
      {
        kind: "slot",
        parent: node(find(parent)),
        slot: "children",
        inherited: [],
      },
      sources()
    );

  it.each([
    ["Button", "Linked card"],
    ["Section as header", "Section as footer"],
    ["Section as main", "Section"],
    ["Linked heading", "Linked box"],
    ["Rich text holding a link", "Linked card"],
    ["Embed", "Linked box"],
    ["Form", "Linked card"],
  ])("refuses %s inside %s", (child, parent) => {
    expect(judge(child, parent)).toMatchObject({ allowed: false });
  });

  // An Accordion is a plain box until it holds items, so the spec's case is
  // judged on one holding an item, which is also how it arrives from the Add
  // panel: its slot starts with one.
  it("refuses an Accordion under a link for the item it holds", () => {
    const accordion = coreBlocks.find(block => block.name === "core/accordion");
    const item = {
      id: "i",
      type: "core/accordion-item",
      version: 1,
      props: { title: "Q" },
    };
    const holder: BlockNode = {
      ...node(find("Accordion")),
      slots: { children: [item] },
    };
    expect(accordion?.slots?.children.allow).toContain("core/accordion-item");
    expect(
      canPlace(
        [holder],
        {
          kind: "slot",
          parent: node(find("Linked card")),
          slot: "children",
          inherited: [],
        },
        sources()
      )
    ).toMatchObject({
      reason: "content-model",
      blockType: "core/accordion-item",
    });
  });

  it("refuses turning a Card's link on while it holds a Button, judged on the Button", () => {
    const button = node(find("Button"));
    const linked: BlockNode = {
      ...node(find("Linked card")),
      slots: { children: [button] },
    };
    expect(canPlace([linked], { kind: "root" }, sources())).toMatchObject({
      reason: "content-model",
      blockType: "core/button",
      refusedBy: { type: "core/card", id: linked.id },
    });
  });
});

describe("the link on Box and Card", () => {
  const render = (element: ReactElement) => renderToStaticMarkup(element);
  const args = (props: Record<string, unknown>) =>
    ({ props, className: "nx-b", renderSlot: () => "inside" }) as never;

  it("renders the block's root as a link while it has a usable destination", () => {
    for (const block of [box, card]) {
      expect(
        render(
          block.render(args({ as: "article", link: "/go" })) as ReactElement
        )
      ).toBe('<a class="nx-b" href="/go">inside</a>');
    }
  });

  it("renders its tag, and no link, for a destination the renderer refuses", () => {
    expect(
      render(
        card.render(
          args({ as: "article", link: "javascript:alert(1)" })
        ) as ReactElement
      )
    ).toBe('<article class="nx-b">inside</article>');
  });

  it("lays a linked block out as a block on both presets, whatever its tag", () => {
    expect(box.baseStyles?.base?.base).toMatchObject(LINKABLE_BASE_STYLE);
    expect(card.baseStyles?.base?.base).toMatchObject(LINKABLE_BASE_STYLE);
  });

  it("is declared on Box and Card only", () => {
    const linkable = coreBlocks
      .filter(
        block =>
          (block.props as Record<string, unknown> | undefined)?.link !==
          undefined
      )
      .map(block => block.name);
    expect(linkable.sort()).toEqual(["core/box", "core/card"]);
  });
});
