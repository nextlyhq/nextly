/**
 * Where the space between and inside blocks comes from.
 *
 * A block carries no outer margin of its own. The space between two blocks is
 * the gap of the container holding them, and the space inside a band is its
 * padding, all read from site tokens. These assert what each block DECLARES
 * and what the compiled sheet of a whole page carries; that a browser resolves
 * it as intended (the h2 sits flush, the second child gets the gap, an author's
 * margin wins) is asserted on a served page in `e2e/tests/blocks-page.spec.ts`.
 */
import type { BlockDocument, BlockNode } from "@nextlyhq/blocks-engine";
import {
  CHILD_GAP_CLASS,
  nodeClassName,
  PAGE_ROOT_CLASS,
  PAGE_ROOT_SELECTOR,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { BlockResolver } from "../resolver";
import { resolvePageStyles, type PageStyles } from "../styles";

import { accordion } from "./accordion";
import { accordionItem } from "./accordion-item";
import { box } from "./box";
import { BUTTON_BASE_STYLES } from "./button";
import { card } from "./card";
import { collectionLoop } from "./collection-loop";
import { column } from "./column";
import { columns } from "./columns";
import { gallery } from "./gallery";
import { coreBlocks } from "./index";
import { richText } from "./rich-text";
import { section } from "./section";

const STACK = { $token: "space.stack" };

describe("the space between blocks belongs to their container", () => {
  it.each([
    ["a section", section],
    ["a box", box],
    ["a card", card],
    ["a column", column],
    ["an accordion item", accordionItem],
    ["a collection loop", collectionLoop],
  ] as const)("%s spaces its children by the stack token", (_, block) => {
    expect(block.childGap).toEqual(STACK);
  });

  it("rich text spaces its own paragraphs, inside the block", () => {
    expect(richText.childGap).toEqual({ $token: "space.paragraph" });
  });

  it.each([
    ["columns", columns],
    ["gallery", gallery],
    ["accordion", accordion],
  ] as const)(
    "a %s is already a grid, so it spaces with gap and no flow margin",
    (_, block) => {
      expect(block.childGap).toBeUndefined();
      expect(JSON.stringify(block.baseStyles)).toContain('"gap":');
    }
  );

  it("separates columns and gallery tiles by the columns token", () => {
    expect(columns.baseStyles?.base?.base?.gap).toEqual({
      $token: "space.columns",
    });
    expect(gallery.baseStyles?.base?.base?.gap).toEqual({
      $token: "space.columns",
    });
    expect(accordion.baseStyles?.base?.base?.gap).toEqual(STACK);
  });
});

describe("the space inside a band", () => {
  it("pads a section by the section and gutter tokens", () => {
    expect(section.baseStyles?.base?.base?.padding).toEqual({
      blockStart: { $token: "space.section-y" },
      blockEnd: { $token: "space.section-y" },
      inlineStart: { $token: "space.gutter" },
      inlineEnd: { $token: "space.gutter" },
    });
  });

  it("pads a card by the card token", () => {
    const inset = { $token: "space.card" };
    expect(card.baseStyles?.base?.base?.padding).toEqual({
      blockStart: inset,
      blockEnd: inset,
      inlineStart: inset,
      inlineEnd: inset,
    });
  });

  it("leaves a box and a column unpadded", () => {
    expect(JSON.stringify(box.baseStyles)).not.toContain("padding");
    expect(JSON.stringify(column.baseStyles)).not.toContain("padding");
  });

  it("pads a button by the button tokens", () => {
    const y = { $token: "button.padding-y" };
    const x = { $token: "button.padding-x" };
    expect(BUTTON_BASE_STYLES.base.base.padding).toEqual({
      blockStart: y,
      blockEnd: y,
      inlineStart: x,
      inlineEnd: x,
    });
  });
});

describe("a whole page's sheet", () => {
  const node = (id: string, type: string, extra: object = {}): BlockNode =>
    ({ id, type, version: 1, props: {}, ...extra }) as BlockNode;

  const DOC: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      node("band", "core/section", {
        slots: {
          children: [
            node("title", "core/heading", {
              props: { text: "T", level: "h2" },
            }),
            node("lead", "core/text", { props: { text: "L" } }),
            node("spaced", "core/text", {
              props: { text: "S" },
              styles: { base: { base: { margin: { blockStart: "40px" } } } },
            }),
          ],
        },
      }),
    ],
  };

  function compiled(): string {
    const resolver: BlockResolver = {
      get: (name: string) =>
        coreBlocks.find(block => block.name === name) as never,
    };
    return (
      resolvePageStyles(
        DOC,
        undefined,
        {
          breakpoints: {
            viewport: [{ id: "base", label: "Desktop" }],
            container: [],
          },
        },
        resolver
      ).css ?? ""
    );
  }

  it("gives a heading no outer margin", () => {
    expect(compiled()).toContain(
      `.${PAGE_ROOT_CLASS} :where(h2) { font-size: 1.75em; font-weight: 700; line-height: 1.2; margin-block-end: 0; margin-block-start: 0 }`
    );
  });

  it("spaces the section's second child by the stack token", () => {
    expect(compiled()).toContain(
      `.${PAGE_ROOT_CLASS} :where(.nx-bt-core--section.${CHILD_GAP_CLASS} > * + *) { margin-block-start: var(--site-space-stack) }`
    );
  });

  it("pads the section by its tokens", () => {
    expect(compiled()).toContain(
      "padding-block-start: var(--site-space-section-y)"
    );
  });

  it("keeps an author's margin on a child, at a heavier selector after the gap", () => {
    const css = compiled();
    const own = `${PAGE_ROOT_SELECTOR} .${nodeClassName("spaced")} { margin-block-start: 40px }`;
    const gap = css.indexOf("> * + *");
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(css.indexOf(own)).toBeGreaterThan(gap);
  });
});

describe("a sheet stored by the compiler before this spacing", () => {
  const STORED_DOC: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "t",
        type: "core/heading",
        version: 1,
        props: { text: "T", level: "h2" },
      } as BlockNode,
    ],
  };
  const resolver: BlockResolver = {
    get: (name: string) =>
      coreBlocks.find(block => block.name === name) as never,
  };
  const context = {
    breakpoints: {
      viewport: [{ id: "base", label: "Desktop" }],
      container: [],
    },
  };

  /**
   * An artifact as the `v3` compiler stored it: the heading's old outer
   * margins in its CSS, and a stamp under the `v3` encoding.
   */
  function storedByV3(): PageStyles {
    const current = resolvePageStyles(STORED_DOC, undefined, context, resolver);
    return {
      ...current,
      css: `.${PAGE_ROOT_CLASS} :where(h2) { margin-block-start: 1.5em; margin-block-end: 0.5em }`,
      sharedInputsId: current.sharedInputsId?.replace(/^v\d+:/, "v3:"),
    } as PageStyles;
  }

  it("is recompiled with the new spacing on a read with no compile context", () => {
    const served = resolvePageStyles(
      STORED_DOC,
      storedByV3(),
      undefined,
      resolver
    );
    // Not the stored sheet, and not withheld: a fresh compile carrying the
    // heading's new flush margins.
    expect(served.css).not.toContain("1.5em");
    expect(served.css).toContain(
      `.${PAGE_ROOT_CLASS} :where(h2) { font-size: 1.75em; font-weight: 700; line-height: 1.2; margin-block-end: 0; margin-block-start: 0 }`
    );
    expect(served.sharedInputsId?.startsWith("v5:")).toBe(true);
    expect(Object.keys(served.classes)).toContain("t");
  });

  it("CONTROL: a sheet stored by the current compiler is served as it stands", () => {
    const current = resolvePageStyles(STORED_DOC, undefined, context, resolver);
    const served = resolvePageStyles(STORED_DOC, current, undefined, resolver);
    expect(served.css).toBe(current.css);
  });

  describe("under a fetch policy", () => {
    const REFUSED = "https://cdn.other.test/a.png";
    const POLICY = "allowed-only";
    const mayFetchUrl = (url: string) =>
      url.startsWith("https://cdn.allowed.test/");
    const URL_DOC: BlockDocument = {
      ...STORED_DOC,
      nodes: [
        {
          id: "t",
          type: "core/text",
          version: 1,
          props: { text: "T" },
          styles: { base: { base: { background: { url: REFUSED } } } },
        } as BlockNode,
      ],
    };

    /** The same `v3` artifact, stamped with the policy in force now. */
    function storedUnderPolicy(): PageStyles {
      const current = resolvePageStyles(URL_DOC, undefined, context, resolver);
      return {
        ...current,
        css: "",
        sharedInputsId: current.sharedInputsId?.replace(/^v\d+:/, "v3:"),
        fetchPolicyId: POLICY,
      } as PageStyles;
    }

    it("judges its URLs by the policy in force when it recompiles", () => {
      const served = resolvePageStyles(
        URL_DOC,
        storedUnderPolicy(),
        undefined,
        resolver,
        false,
        { fetchPolicyId: POLICY, mayFetchUrl }
      );
      expect(served.sharedInputsId?.startsWith("v5:")).toBe(true);
      expect(served.css).not.toContain("cdn.other.test");
    });

    it("is withheld when the read names a policy without its predicate", () => {
      const served = resolvePageStyles(
        URL_DOC,
        storedUnderPolicy(),
        undefined,
        resolver,
        false,
        { fetchPolicyId: POLICY }
      );
      expect(served.css).toBe("");
      expect(Object.keys(served.classes)).toContain("t");
    });
  });

  it("is recompiled where a compile context exists", () => {
    const served = resolvePageStyles(
      STORED_DOC,
      storedByV3(),
      context,
      resolver
    );
    expect(served.css).not.toContain("1.5em");
    expect(served.sharedInputsId?.startsWith("v5:")).toBe(true);
  });
});
