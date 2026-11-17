/**
 * The element tier every page compiles with: the site's text, read from the
 * compile context, over the elements' own defaults.
 *
 * The block library holds no heading table of its own. It derives the tier
 * from the site text map the context carries (`siteText`), or from the
 * engine's built-in rows when the context carries none, so the canvas, a
 * published page, a stored sheet and the style trace compile the same rules.
 *
 * The cascade itself is not observable in jsdom, which resolves no
 * stylesheet, so the order is read off the compiled trace by the engine's own
 * cascade reader, one tier added at a time.
 *
 * @module blocks/__tests__/typography-defaults
 */
import {
  defaultSiteTokens,
  styleOrigin,
  type BlockDocument,
  type NamedClass,
  type NodeStyles,
  type SiteTextMap,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import type { BlockResolver } from "../resolver";
import { resolvePageStylesWithTrace } from "../styles";

import { coreBlocks } from "./index";
import { withTypographyDefaults } from "./typography-defaults";

const breakpoints = { viewport: [], container: [] };
const resolver: BlockResolver = {
  get: (name: string) => coreBlocks.find(block => block.name === name) as never,
};
const fontSize = (value: string): NodeStyles =>
  ({ base: { base: { fontSize: value } } }) as unknown as NodeStyles;

/** A page holding these nodes. */
const page = (nodes: unknown[]): BlockDocument =>
  ({ formatVersion: 1, kind: "page", nodes }) as unknown as BlockDocument;

/** The compiled page sheet and its trace, for a context. */
function compiled(document: BlockDocument, context: StyleCompileContext) {
  const { styles, trace } = resolvePageStylesWithTrace(
    document,
    undefined,
    context,
    resolver,
    false,
    { trace: true }
  );
  return { css: styles.css, trace: trace ?? [] };
}

describe("the element tier a page compiles with", () => {
  it("sizes each heading level with the built-in type size of its level", () => {
    const tier = withTypographyDefaults({ breakpoints }).elementBases;
    for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
      expect(tier?.[level]?.base?.base?.fontSize).toEqual({
        $token: `font-size.${level}`,
      });
      expect(tier?.[level]?.base?.base?.lineHeight).toEqual({
        $token: `line-height.${level}`,
      });
    }
  });

  it("follows the site's text the context carries", () => {
    const siteText: SiteTextMap = {
      h2: { fontSize: "40px", lineHeight: 1.1 },
      body: { fontSize: "18px" },
    };
    const tier = withTypographyDefaults({ breakpoints, siteText }).elementBases;
    expect(tier?.h2?.base?.base?.fontSize).toBe("40px");
    expect(tier?.root?.base?.base?.fontSize).toBe("18px");
    // The other levels keep their built-in rows.
    expect(tier?.h3?.base?.base?.fontSize).toEqual({ $token: "font-size.h3" });
  });

  it("leaves a context that states its own tier alone", () => {
    const stated = { breakpoints, elementBases: {} };
    // Identity, not equality: a host replacing the tier must be handed back
    // the SAME record it chose.
    expect(withTypographyDefaults(stated).elementBases).toBe(
      stated.elementBases
    );
  });

  it("renders each heading at today's size at a 16px root, with no rule for body text, links or captions", () => {
    const { css } = compiled(
      page(
        (["h1", "h2", "h3", "h4", "h5", "h6"] as const).map((level, at) => ({
          id: `h${at}`,
          type: "core/heading",
          version: 1,
          props: { text: "Title", level },
        }))
      ),
      { breakpoints }
    );
    const builtIn = new Map(
      defaultSiteTokens().map(token => [token.name, token.values.light])
    );
    // The sizes the block library drew before, in em against a 16px root.
    const today = { h1: 36, h2: 28, h3: 22, h4: 18, h5: 16, h6: 14 };
    for (const [level, px] of Object.entries(today)) {
      const rule = new RegExp(
        `:where\\(${level}\\) \\{[^}]*font-size: var\\(--site-font-size-${level}\\)`
      );
      expect(css).toMatch(rule);
      const value = builtIn.get(`font-size.${level}`) ?? "";
      expect(value.endsWith("rem")).toBe(true);
      expect(Number.parseFloat(value) * 16).toBe(px);
    }
    expect(css).not.toMatch(/:where\(a\)/);
    expect(css).not.toMatch(/:where\(figcaption\)/);
    expect(css).not.toMatch(/^\.nx-pb-page \{/m);
  });

  it("gives headings and paragraphs no outer margin after any row change", () => {
    const tier = withTypographyDefaults({
      breakpoints,
      siteText: {
        body: { fontSize: "20px", lineHeight: 1.7 },
        h1: { fontSize: "60px", lineHeight: 1 },
        h2: {},
      },
    }).elementBases;
    for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6", "p"] as const) {
      expect(tier?.[tag]?.base?.base?.margin).toEqual({
        blockStart: "0",
        blockEnd: "0",
      });
    }
    expect(JSON.stringify(tier?.root)).not.toContain("margin");
  });
});

describe("links in text", () => {
  /** A rich text block holding a link in a paragraph and one in a heading. */
  const linked = page([
    {
      id: "rt",
      type: "core/rich-text",
      version: 1,
      props: {
        html: '<p>Read <a href="/a">this</a></p><h2>See <a href="/b">that</a></h2>',
      },
    },
  ]);

  it("take their colour and underline from the Links row, and their size from the text around them", () => {
    const { css, trace } = compiled(linked, {
      breakpoints,
      siteText: {
        link: { color: "#0044cc", hoverColor: "#002266", underline: "hover" },
      },
    });
    expect(css).toMatch(
      /:where\(a\) \{ color: #0044cc; text-decoration: none \}/
    );
    expect(css).toMatch(
      /:where\(a:where\(:hover\)\) \{ color: #002266; text-decoration: underline \}/
    );
    // No size on the link: in the paragraph it is the body's, in the heading
    // the heading's, by inheritance.
    const linkSizes = trace.filter(
      entry =>
        entry.origin.kind === "element" &&
        entry.origin.tag === "a" &&
        entry.property === "font-size"
    );
    expect(linkSizes).toEqual([]);
    const forLink = { nodeId: "rt", blockType: "core/rich-text", tag: "a" };
    const ask = {
      property: "font-size",
      state: "base",
      breakpoints: ["base"],
    } as const;
    expect(styleOrigin(trace, forLink, ask)).toBeUndefined();
  });
});

describe("buttons and captions", () => {
  it("lays the Buttons row over the Button block's label and the form's button", () => {
    const { css } = compiled(
      page([
        { id: "b", type: "core/button", version: 1, props: { label: "Go" } },
        { id: "f", type: "core/form", version: 1, props: {} },
      ]),
      {
        breakpoints,
        siteText: { button: { fontSize: "15px", lineHeight: 1.25 } },
      }
    );
    const button = css.match(/:where\(\.nx-bt-core--button\) \{[^}]*\}/)?.[0];
    expect(button).toContain("font-size: 15px");
    expect(button).toContain("line-height: 1.25");
    // The button's own padding and colour are untouched.
    expect(button).toContain("background-color: var(--site-color-primary)");
    const submit = css.match(
      /:where\(\.nx-bp-core--form--submit\) \{[^}]*\}/
    )?.[0];
    expect(submit).toContain("font-size: 15px");
  });

  it("lays the Captions row over the Image block's caption, and writes it on every figcaption", () => {
    const { css } = compiled(
      page([
        {
          id: "i",
          type: "core/image",
          version: 1,
          props: { src: "/a.png", alt: "A", caption: "A picture" },
        },
      ]),
      { breakpoints, siteText: { caption: { fontSize: "13px" } } }
    );
    const caption = css.match(
      /:where\(\.nx-bp-core--image--caption\) \{[^}]*\}/
    )?.[0];
    expect(caption).toContain("font-size: 13px");
    expect(css).toMatch(/:where\(figcaption\) \{ font-size: 13px \}/);
  });

  it("leaves the blocks as their code draws them while the rows are empty", () => {
    const { css } = compiled(
      page([
        { id: "b", type: "core/button", version: 1, props: { label: "Go" } },
      ]),
      { breakpoints }
    );
    const button = css.match(/:where\(\.nx-bt-core--button\) \{[^}]*\}/)?.[0];
    expect(button).toContain("font-size: inherit");
  });
});

describe("who wins over a row", () => {
  const ownLook: NamedClass = {
    id: "look:core/heading:own",
    slug: "heading-own",
    orderIndex: 0,
    blockType: "core/heading",
    isDefault: true,
    styles: fontSize("31px"),
  };
  const look: NamedClass = {
    id: "look-big",
    slug: "big",
    orderIndex: 1,
    blockType: "core/heading",
    styles: fontSize("32px"),
  };
  const shared: NamedClass = {
    id: "shared-1",
    slug: "shared",
    orderIndex: 2,
    styles: fontSize("33px"),
  };

  /** Where an H2's size comes from, under these classes and own value. */
  function sizeFrom(
    library: readonly NamedClass[],
    wears: readonly string[],
    own?: NodeStyles
  ): string | undefined {
    const { trace } = compiled(
      page([
        {
          id: "n1",
          type: "core/heading",
          version: 1,
          props: { text: "Title", level: "h2" },
          classes: [...wears],
          ...(own === undefined ? {} : { styles: own }),
        },
      ]),
      {
        breakpoints,
        namedClasses: [...library],
        siteText: { h2: { fontSize: "30px" } },
      }
    );
    const origin = styleOrigin(
      trace,
      {
        nodeId: "n1",
        blockType: "core/heading",
        classIds: [...wears],
        tag: "h2",
      },
      { property: "font-size", state: "base", breakpoints: ["base"] }
    );
    return origin?.value;
  }

  it("a row is the weakest", () => {
    expect(sizeFrom([], [])).toBe("30px");
  });

  it("the block type's own default style beats the row", () => {
    expect(sizeFrom([ownLook], [])).toBe("31px");
  });

  it("a block style the block wears beats the block type's default", () => {
    expect(sizeFrom([ownLook, look], [look.id])).toBe("32px");
  });

  it("a shared style beats a block style", () => {
    expect(sizeFrom([ownLook, look, shared], [look.id, shared.id])).toBe(
      "33px"
    );
  });

  it("the block's own value beats everything", () => {
    expect(
      sizeFrom([ownLook, look, shared], [look.id, shared.id], fontSize("34px"))
    ).toBe("34px");
  });
});
