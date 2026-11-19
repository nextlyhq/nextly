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
import type {
  BlockDocument,
  BlockNode,
  StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import {
  CHILD_GAP_CLASS,
  nodeClassName,
  PAGE_ROOT_CLASS,
  PAGE_ROOT_SELECTOR,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PageContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver, type BlockResolver } from "../resolver";
import { sharedStyleInputsId } from "../shared-style-inputs";
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
      `.${PAGE_ROOT_CLASS} :where(h2) { font-size: var(--site-font-size-h2); font-weight: 700; line-height: var(--site-line-height-h2); margin-block-end: 0; margin-block-start: 0 }`
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
      `.${PAGE_ROOT_CLASS} :where(h2) { font-size: var(--site-font-size-h2); font-weight: 700; line-height: var(--site-line-height-h2); margin-block-end: 0; margin-block-start: 0 }`
    );
    expect(served.sharedInputsId?.startsWith("v13:")).toBe(true);
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
      expect(served.sharedInputsId?.startsWith("v13:")).toBe(true);
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
    expect(served.sharedInputsId?.startsWith("v13:")).toBe(true);
  });
});

/**
 * One set of defaults, whatever a site's stored style still says.
 *
 * A site's stored style may still carry a `spacingMode` key from before there
 * was one way to space blocks, and it reaches the renderer with the rest of
 * the style. Nothing reads it any more, so it must change nothing a visitor
 * is served. Spread in as a plain value, the way an untyped stored document
 * arrives, rather than as a typed field.
 */
describe("a site whose stored style still names a spacing model", () => {
  const LEFTOVER = { spacingMode: "classic" } as const;
  const BREAKPOINTS = {
    viewport: [{ id: "base", label: "Desktop" }],
    container: [],
  };

  const node = (
    id: string,
    type: string,
    props: Record<string, unknown> = {},
    children?: readonly BlockNode[],
    extra: object = {}
  ): BlockNode =>
    ({
      id,
      type,
      version: 1,
      props,
      ...(children === undefined ? {} : { slots: { children } }),
      ...extra,
    }) as BlockNode;

  const text = (value: string) => ({ type: "text", text: value });

  /** Every block whose spacing once differed, nested as a site builds them. */
  const PAGE: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      node("band", "core/section", {}, [
        node("title", "core/heading", { text: "Title", level: "h1" }),
        node("sub", "core/heading", { text: "Sub", level: "h2" }),
        node("lead", "core/text", { text: "Lead" }),
        node("body", "core/rich-text", {
          content: {
            root: {
              type: "root",
              children: [
                { type: "heading", tag: "h3", children: [text("Inside")] },
                { type: "paragraph", children: [text("One")] },
                { type: "image", src: "/a.png", altText: "A" },
              ],
            },
          },
        }),
        node("said", "core/quote", { text: "Said" }),
        node("rule", "core/divider"),
        node("go", "core/button", { text: "Go" }),
        node("tile", "core/card", {}, [node("in-card", "core/text")]),
        node("row", "core/columns", {}, [
          node("left", "core/column", {}, [node("l-text", "core/text")]),
        ]),
        node("pics", "core/gallery"),
        node("faq", "core/accordion", {}, [
          node("q1", "core/accordion-item", { title: "Q" }, [
            node("a1", "core/text"),
          ]),
        ]),
        // Two buttons in a box laid out as a row: the gap must reach a flex
        // row as it reaches a stack.
        node(
          "pair",
          "core/box",
          {},
          [
            node("yes", "core/button", { text: "Yes" }),
            node("no", "core/button", { text: "No" }),
          ],
          { styles: { base: { base: { display: "flex" } } } }
        ),
        node("loop", "core/collection-loop", { collection: "posts" }, [
          node("entry-text", "core/text"),
        ]),
      ]),
    ],
  };

  // Two entries, so the loop draws an entry wrapper for each.
  const CONTEXT = {
    entry: null,
    data: {
      find: () =>
        Promise.resolve({ items: [{ id: "e1" }, { id: "e2" }], total: 2 }),
    },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  } as unknown as PageContext;

  /**
   * The page as a visitor is served it, with `stored` as the site's style and
   * `route` beside the breakpoints of the route's own compile context.
   */
  async function served(stored: object, route: object = {}): Promise<string> {
    const stream = await renderToReadableStream(
      <PageRenderer
        document={PAGE}
        blocks={createBlockResolver(coreBlocks)}
        context={CONTEXT}
        styleContext={{ breakpoints: BREAKPOINTS, ...route }}
        siteStyles={{ breakpoints: BREAKPOINTS, ...stored }}
      />
    );
    await stream.allReady;
    return new Response(stream).text();
  }

  /** A block type's own rule in the served sheet. */
  const typeRule = (html: string, type: string): string =>
    new RegExp(`:where\\(\\.nx-bt-${type}\\) \\{[^}]*\\}`).exec(html)?.[0] ??
    "";

  it("serves exactly the page the same site serves without the key", async () => {
    expect(await served(LEFTOVER)).toBe(await served({}));
  });

  it("serves exactly that page when a route's own compile context states the key", async () => {
    expect(await served({}, LEFTOVER)).toBe(await served({}));
  });

  it("compiles and stamps a stored sheet alike when a route's compile context states the key", () => {
    const compiled = (route: object) =>
      resolvePageStyles(
        PAGE,
        undefined,
        { breakpoints: BREAKPOINTS, ...route },
        createBlockResolver(coreBlocks)
      );
    const withKey = compiled(LEFTOVER);
    const without = compiled({});
    // The gaps are in the sheet, so the equality below is not two empty ones.
    expect(without.css).toContain(`${CHILD_GAP_CLASS} > * + *`);
    expect(withKey.css).toBe(without.css);
    expect(withKey.sharedInputsId).toBe(without.sharedInputsId);
  });

  it.each(["h1", "h2", "h3", "h4", "h5", "h6", "p"])(
    "gives %s no outer margin",
    async element => {
      expect(await served(LEFTOVER)).toMatch(
        new RegExp(
          `:where\\(${element}\\) \\{[^}]*margin-block-end: 0; margin-block-start: 0 \\}`
        )
      );
    }
  );

  it.each([
    "section",
    "card",
    "column",
    "accordion-item",
    "rich-text",
    "box",
    "collection-loop",
  ])("writes the gap of a %s and marks it for the gap", async type => {
    const html = await served(LEFTOVER);
    expect(html).toContain(
      `:where(.nx-bt-core--${type}.${CHILD_GAP_CLASS} > * + *) { margin-block-start: var(`
    );
    expect(html).toMatch(
      new RegExp(`class="[^"]*${CHILD_GAP_CLASS} nx-bt-core--${type}"`)
    );
  });

  it("marks each collection loop entry for the gap", async () => {
    const html = await served(LEFTOVER);
    const entries = html.match(
      new RegExp(`class="nx-bt-core--collection-loop ${CHILD_GAP_CLASS}"`, "g")
    );
    expect(entries).toHaveLength(2);
  });

  it.each([
    ["columns", "var(--site-space-columns)"],
    ["gallery", "var(--site-space-columns)"],
    ["accordion", "var(--site-space-stack)"],
  ])("spaces a %s grid by its own token", async (type, gap) => {
    expect(typeRule(await served(LEFTOVER), `core--${type}`)).toContain(
      `gap: ${gap}`
    );
  });

  // A guard on the block-type tier, beside the element rules asserted above:
  // classic wrote its margins on the element rules, so this holds on either
  // model and only keeps a future block default from adding one.
  it("writes no outer margin on a Heading, Text or Button block-type rule", async () => {
    const html = await served(LEFTOVER);
    const rules = html.match(/:where\([^)]*\) \{[^}]*\}/g) ?? [];
    // The control: the scan reads the block-type rules, the button's among them.
    expect(rules.some(rule => rule.includes(".nx-bt-core--button)"))).toBe(
      true
    );
    const outerMargin = /margin-block-(start|end): (?!0[ ;}])/;
    for (const type of ["heading", "text", "button"]) {
      const own = rules.filter(rule => rule.includes(`.nx-bt-core--${type}`));
      expect(own.filter(rule => outerMargin.test(rule))).toEqual([]);
    }
  });

  it("gives a quote and a divider no outer margin", async () => {
    const html = await served(LEFTOVER);
    for (const type of ["quote", "divider"]) {
      expect(typeRule(html, `core--${type}`)).toContain(
        "margin-block-end: 0; margin-block-start: 0"
      );
    }
  });

  it("pads a card and a button by their tokens", async () => {
    const html = await served(LEFTOVER);
    expect(typeRule(html, "core--card")).toContain(
      "padding-block-start: var(--site-space-card)"
    );
    expect(typeRule(html, "core--button")).toContain(
      "padding-block-start: var(--site-button-padding-y)"
    );
  });

  it("gives an image in rich text only the inline margin reset", async () => {
    expect(await served(LEFTOVER)).toContain(
      '<figure class="nextly-rich-text-image" style="margin-inline:0">'
    );
  });

  it("keeps a stored sheet's stamp, so the key alone recompiles nothing", () => {
    const context: StyleCompileContext = {
      breakpoints: BREAKPOINTS,
      elementBases: {},
    };
    expect(sharedStyleInputsId({ ...context, ...LEFTOVER })).toBe(
      sharedStyleInputsId(context)
    );
  });
});

/**
 * A page stylesheet stored for a site on the classic model, before there was
 * one way to space blocks. Captured from that compiler: `resolvePageStyles`
 * on this document with `spacingMode: "classic"` on its compile context, the
 * way a classic site's page was stored. Its rules carry the old heading and
 * paragraph margins and no container gap.
 */
describe("a sheet stored for a classic site before one spacing model", () => {
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
          ],
        },
      }),
    ],
  };
  const STORED_UNDER_CLASSIC = {
    css: [
      ".nx-pb-page :where(h1) { font-size: 2.25em; font-weight: 700; line-height: 1.15; margin-block-end: 0.5em; margin-block-start: 1.5em }",
      ".nx-pb-page :where(h2) { font-size: 1.75em; font-weight: 700; line-height: 1.2; margin-block-end: 0.5em; margin-block-start: 1.5em }",
      ".nx-pb-page :where(h3) { font-size: 1.375em; font-weight: 700; line-height: 1.3; margin-block-end: 0.5em; margin-block-start: 1.5em }",
      ".nx-pb-page :where(h4) { font-size: 1.125em; font-weight: 700; line-height: 1.4; margin-block-end: 0.5em; margin-block-start: 1.5em }",
      ".nx-pb-page :where(h5) { font-size: 1em; font-weight: 700; line-height: 1.45; margin-block-end: 0.5em; margin-block-start: 1.5em }",
      ".nx-pb-page :where(h6) { font-size: 0.875em; font-weight: 700; line-height: 1.5; margin-block-end: 0.5em; margin-block-start: 1.5em }",
      ".nx-pb-page :where(p) { margin-block-end: 1em; margin-block-start: 0 }",
    ].join("\n"),
    classes: {
      band: "nx-pb-gtwts95k29",
      title: "nx-pb-1gso67mluts",
      lead: "nx-pb-ckj5133jck",
    },
    sharedInputsId: "v5:iw813scoeh",
  } as PageStyles;
  const resolver = createBlockResolver(coreBlocks);
  const BREAKPOINTS = {
    viewport: [{ id: "base", label: "Desktop" }],
    container: [],
  };
  const read = (stored: PageStyles, route: object = {}) =>
    resolvePageStyles(
      DOC,
      stored,
      { breakpoints: BREAKPOINTS, ...route },
      resolver
    );

  it.each([
    ["with no spacing model stated", {}],
    ["with the route still stating classic", { spacingMode: "classic" }],
  ])("is recompiled with gaps on the next read, %s", (_, route) => {
    const served = read(STORED_UNDER_CLASSIC, route);
    expect(served.sharedInputsId).not.toBe(STORED_UNDER_CLASSIC.sharedInputsId);
    expect(served.css).not.toContain("margin-block-start: 1.5em");
    expect(served.css).toContain(
      `:where(h2) { font-size: var(--site-font-size-h2); font-weight: 700; line-height: var(--site-line-height-h2); margin-block-end: 0; margin-block-start: 0 }`
    );
    expect(served.css).toContain(
      `:where(.nx-bt-core--section.${CHILD_GAP_CLASS} > * + *) { margin-block-start: var(--site-space-stack) }`
    );
  });

  it("is recompiled with gaps on a read with no compile context", () => {
    // Where no context exists the stamp's hash cannot be compared, only the
    // encoding it was written under, so this read reaches a fresh compile
    // only because the encoding moved past the one that stored the sheet.
    const served = resolvePageStyles(
      DOC,
      STORED_UNDER_CLASSIC,
      undefined,
      resolver
    );
    expect(served.css).not.toContain("margin-block-start: 1.5em");
    expect(served.css).toContain(
      `:where(h2) { font-size: var(--site-font-size-h2); font-weight: 700; line-height: var(--site-line-height-h2); margin-block-end: 0; margin-block-start: 0 }`
    );
    expect(Object.keys(served.classes)).toContain("title");
  });

  it("CONTROL: a sheet stored by the current compiler is served as it stands", () => {
    const current = resolvePageStyles(
      DOC,
      undefined,
      { breakpoints: BREAKPOINTS },
      resolver
    );
    // Marked so a recompile would show: the same stamp, a css nobody compiles.
    const marked = { ...current, css: `${current.css}\n/* stored */` };
    expect(read(marked).css).toBe(marked.css);
  });
});
