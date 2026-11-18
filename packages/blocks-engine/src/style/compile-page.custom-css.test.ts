/**
 * Custom CSS in the page's sheet: the site's, then the page's, then each
 * block's scoped to the block, after every rule the builder writes; and only
 * what the host's checker accepts. With no checker none of it is drawn, and a
 * value the checker refuses stays in the document but never reaches the sheet.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import {
  compilePageCss,
  type CustomCssPolicy,
  type StyleCompileContext,
} from "./compile-page";
import { nodeClassName, PAGE_ROOT_SELECTOR } from "./node-class";

const SITE = ".site-mark { color: olive; }";
const PAGE = ".page-mark { color: teal; }";
const BLOCK = "selector { border: 4px solid blue; }";

const text = (id: string, extra: Record<string, unknown> = {}): BlockNode =>
  ({
    id,
    type: "core/text",
    version: 1,
    props: { text: "Words" },
    // A style of its own, so the builder writes a rule for it to order against.
    styles: { base: { base: { color: "#111111" } } },
    ...extra,
  }) as unknown as BlockNode;

const page = (
  nodes: BlockNode[],
  settings: Record<string, unknown> = { customCss: PAGE }
): BlockDocument =>
  ({
    formatVersion: 1,
    kind: "page",
    nodes,
    settings,
  }) as unknown as BlockDocument;

/** A checker accepting everything but what `refuse` names. */
const policy = (
  refuse: readonly string[] = [],
  // `null` for no site CSS: an `undefined` argument would take the default.
  site: string | null = SITE
): CustomCssPolicy => ({
  id: "test-checker",
  accepts: css => !refuse.includes(css),
  ...(site === null ? {} : { site }),
});

const compile = (doc: BlockDocument, customCss?: CustomCssPolicy) => {
  const ctx: StyleCompileContext = {
    breakpoints: FIXTURE_BREAKPOINTS,
    ...(customCss === undefined ? {} : { customCss }),
  };
  return compilePageCss(doc, ctx);
};

const scopedBlock = (id: string) =>
  `${PAGE_ROOT_SELECTOR} .${nodeClassName(id)} { border: 4px solid blue; }`;

describe("custom CSS in the page's sheet", () => {
  it("is drawn site, then page, then block, after the builder's rules", () => {
    const { css } = compile(page([text("a", { customCss: BLOCK })]), policy());
    const builder = css.indexOf("#111111");
    const site = css.indexOf(SITE);
    const pageAt = css.indexOf(PAGE);
    const block = css.indexOf(scopedBlock("a"));
    expect(builder).toBeGreaterThanOrEqual(0);
    expect(site).toBeGreaterThan(builder);
    expect(pageAt).toBeGreaterThan(site);
    expect(block).toBeGreaterThan(pageAt);
  });

  it("is not drawn at all without a checker", () => {
    const { css } = compile(page([text("a", { customCss: BLOCK })]));
    expect(css).toContain("#111111");
    expect(css).not.toContain("blue");
    expect(css).not.toContain("page-mark");
  });

  it("leaves out what the checker refuses, and keeps the rest", () => {
    const doc = page([
      text("a", { customCss: BLOCK }),
      text("b", { customCss: "selector { color: red; }" }),
    ]);
    const before = JSON.stringify(doc);
    const { css } = compile(doc, policy([BLOCK, PAGE, SITE]));
    expect(css).not.toContain("blue");
    expect(css).not.toContain("page-mark");
    expect(css).not.toContain("site-mark");
    expect(css).toContain(`.${nodeClassName("b")} { color: red; }`);
    // Refused is not removed: the document still holds every value.
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("leaves out a block's CSS it cannot scope to the block", () => {
    const { css } = compile(
      page([text("a", { customCss: "h2 { color: red; }" })]),
      policy()
    );
    expect(css).not.toContain("color: red");
  });

  it("draws no block CSS for two blocks sharing an id", () => {
    const { css } = compile(
      page([text("a", { customCss: BLOCK }), text("a", { customCss: BLOCK })]),
      policy()
    );
    expect(css).not.toContain("blue");
  });

  it("keeps a gated block's CSS with its other rules, out of the sheet", () => {
    const gated = text("g", {
      customCss: BLOCK,
      visibility: { conditions: [[{ field: "tier", op: "eq", value: "vip" }]] },
    });
    const result = compile(page([gated]), policy());
    expect(result.css).not.toContain("blue");
    expect(result.gated?.g).toContain(scopedBlock("g"));
  });

  it("draws no site CSS the checker was not given", () => {
    const { css } = compile(page([]), policy([], null));
    expect(css).not.toContain("site-mark");
    expect(css).toContain(PAGE);
  });
});
