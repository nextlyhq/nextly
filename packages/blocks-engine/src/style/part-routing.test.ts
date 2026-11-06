/**
 * Root properties a block part takes from a wrapping root.
 *
 * An image's picture takes its corners and proportion from a figure (a
 * caption) or a link around it, so the figure's box never carries them. Three
 * questions decide whether that holds: whether every tier that styles a node's
 * root routes alike (or one tier outranks another it used to lose to), whether
 * a property no part takes stays where it was, and whether a wrapper of
 * another block, or a nested block's picture, is ever reached.
 *
 * @module style/part-routing.test
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import type { StyleCompileContext } from "./compile-page";
import type { NamedClass } from "./named-class";
import { blockPartClassName } from "./node-class";
import { compileSiteSheet } from "./site-sheet";

const TYPE = "core/image";
const part = (name: string) => `.${blockPartClassName(TYPE, name)}`;
const FRAME = part("frame");
const LINK = part("link");
const PICTURE = part("picture");

const PARTS = {
  [TYPE]: {
    frame: {},
    link: {},
    picture: {
      takesFromRoot: {
        properties: ["borderRadius", "aspectRatio"],
        whenRootIs: ["frame", "link"],
      },
    },
  },
} as unknown as StyleCompileContext["blockParts"];

const values = (set: Record<string, unknown>) => ({ base: { base: set } });

const circle = {
  id: "look:core/image:circle",
  slug: "image-circle",
  orderIndex: 0,
  blockType: TYPE,
  styles: values({ borderRadius: "9999px", aspectRatio: "1 / 1" }),
} as unknown as NamedClass;
const framed = {
  id: "c-framed",
  slug: "framed",
  orderIndex: 0,
  styles: values({ borderRadius: "4px", backgroundColor: "#eef2ff" }),
} as unknown as NamedClass;

function compile(
  node: Partial<BlockNode>,
  ctx: Partial<StyleCompileContext> = {}
) {
  const doc = {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "n1", type: TYPE, version: 1, props: {}, ...node }],
  } as unknown as BlockDocument;
  return compilePageCss(doc, {
    breakpoints: FIXTURE_BREAKPOINTS,
    blockParts: PARTS,
    namedClasses: [circle, framed],
    ...ctx,
  } as StyleCompileContext);
}

/** Each rule as `selector { body }`, in emission order. */
function rulesOf(css: string): { selector: string; body: string }[] {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(match => ({
    selector: (match[1] ?? "").trim(),
    body: (match[2] ?? "").trim(),
  }));
}

/** The node's own root selector, read off its unrouted rule. */
function nodeRoot(css: string): string {
  const rule = rulesOf(css).find(each =>
    /^\.nx-pb-page\.nx-pb-page \.nx-pb-[a-z0-9]+$/.test(each.selector)
  );
  if (rule === undefined) throw new Error("no node rule");
  return rule.selector;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The selectors a tier's routed corner rules are written on. */
function routedPair(root: string) {
  return {
    off: `${root}:not(${FRAME}, ${LINK})`,
    onto: [
      `${root}${FRAME} > ${PICTURE}`,
      `${root}${FRAME} > ${LINK} > ${PICTURE}`,
      `${root}${LINK} > ${PICTURE}`,
      `${root}${LINK} > ${FRAME} > ${PICTURE}`,
    ].join(", "),
  };
}

describe("a part that takes properties from a wrapping root", () => {
  it("routes every tier's corners and proportion alike, in the tiers' order", () => {
    const { css } = compile({
      classes: [circle.id, framed.id],
      styles: values({ backgroundColor: "#fff", borderRadius: "0" }) as never,
    });
    const rules = rulesOf(css);
    const page = ".nx-pb-page.nx-pb-page";
    const tiers = [
      `${page} .nx-l-image-circle`,
      `${page} .nx-c-framed`,
      nodeRoot(css),
    ];
    // Each tier's routed rules have one shape, so each weighs what the
    // others do and the later tier wins, as before routing.
    const at = tiers.map(root => {
      const { off, onto } = routedPair(root);
      const offAt = rules.findIndex(rule => rule.selector === off);
      const ontoAt = rules.findIndex(rule => rule.selector === onto);
      expect(offAt).toBeGreaterThan(-1);
      expect(ontoAt).toBe(offAt + 1);
      expect(rules[ontoAt]?.body).toBe(rules[offAt]?.body);
      return ontoAt;
    });
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The node's own corner is the last routed value written.
    expect(rules[at[2] ?? -1]?.body).toBe("border-radius: 0");
  });

  it("leaves a property no part takes on the root, as it was", () => {
    const { css } = compile({ classes: [framed.id] });
    expect(css).toContain(
      ".nx-pb-page.nx-pb-page .nx-c-framed { background-color: #eef2ff }"
    );
  });

  it("writes nothing routed for the block's own defaults, which sit on the part", () => {
    const { css } = compile(
      {},
      {
        namedClasses: [],
        blockBases: { [TYPE]: values({ borderRadius: "2px" }) as never },
      }
    );
    expect(css).toContain(
      ".nx-pb-page :where(.nx-bt-core--image) { border-radius: 2px }"
    );
    expect(css).not.toContain(":not(");
  });

  it("reaches the part only through the block's own wrapper, never a nested one", () => {
    // Compounded with the wrapper's class and joined by child combinators: a
    // box wearing the same style cannot reach an image's picture inside it.
    const { css } = compile({ classes: [framed.id] });
    const onto = rulesOf(css).find(
      rule =>
        rule.selector.includes(".nx-c-framed") &&
        rule.selector.includes(PICTURE)
    );
    const selectors = onto?.selector.split(", ") ?? [];
    expect(selectors).toHaveLength(4);
    for (const selector of selectors) {
      expect(selector).toMatch(
        new RegExp(`\\.nx-c-framed(${escaped(FRAME)}|${escaped(LINK)}) > `)
      );
      expect(selector).not.toMatch(/\.nx-c-framed \./);
    }
  });

  it("changes nothing where no part declares a route", () => {
    const { css } = compile(
      { classes: [framed.id] },
      { blockParts: { [TYPE]: { frame: {}, picture: {} } } as never }
    );
    expect(css).toContain(
      ".nx-pb-page.nx-pb-page .nx-c-framed { background-color: #eef2ff; border-radius: 4px }"
    );
  });

  it("ignores a route naming no usable wrapper or no known property", () => {
    for (const takesFromRoot of [
      { properties: ["borderRadius"], whenRootIs: ["Not A Part"] },
      { properties: ["notAProperty"], whenRootIs: ["frame"] },
      { properties: "borderRadius", whenRootIs: ["frame"] },
    ]) {
      const { css } = compile(
        { classes: [framed.id] },
        {
          blockParts: {
            [TYPE]: { frame: {}, picture: { takesFromRoot } },
          } as never,
        }
      );
      expect(css).not.toContain(":not(");
    }
  });

  it("traces a routed value once, as the node's", () => {
    const { trace } = compilePageCss(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "n1",
            type: TYPE,
            version: 1,
            props: {},
            styles: values({ borderRadius: "0" }),
          },
        ],
      } as unknown as BlockDocument,
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        blockParts: PARTS,
        trace: true,
      } as unknown as StyleCompileContext
    ) as unknown as { trace?: { property: string }[] };
    expect(
      (trace ?? []).filter(entry => entry.property === "border-radius")
    ).toHaveLength(1);
  });

  it("routes the classes in the sheet every page shares, writing no part's defaults", () => {
    // The site sheet compiles the classes apart from any page; handed the
    // parts, it routes them as the page sheet does.
    const parts = {
      [TYPE]: {
        ...(PARTS?.[TYPE] ?? {}),
        frame: { baseStyles: values({ display: "flex" }) },
      },
    } as unknown as StyleCompileContext["blockParts"];
    const { css } = compileSiteSheet(
      { breakpoints: FIXTURE_BREAKPOINTS, classes: [framed] },
      parts ?? {}
    );
    const { off, onto } = routedPair(".nx-pb-page.nx-pb-page .nx-c-framed");
    expect(css).toContain(`${off} { border-radius: 4px }`);
    expect(css).toContain(`${onto} { border-radius: 4px }`);
    expect(css).not.toContain("display: flex");
  });
});
