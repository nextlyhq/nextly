/**
 * A container's own content width, as the page compile writes it: one
 * declaration in the node's own rule, which the site sheet's content-width
 * rule reads in place of the site's width.
 */
import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "../document";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import type { StyleCompileContext } from "./compile-page";
import { CONTENT_WIDTH_PROP, CONTENT_WIDTH_PROPERTY } from "./content-width";
import { nodeClassName, PAGE_ROOT_SELECTOR } from "./node-class";

const CTX: StyleCompileContext = { breakpoints: FIXTURE_BREAKPOINTS };

function page(nodes: BlockNode[]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

function section(
  id: string,
  props: Record<string, unknown>,
  children: BlockNode[] = []
): BlockNode {
  return {
    id,
    type: "core/section",
    version: 1,
    props: { contained: true, ...props },
    ...(children.length === 0 ? {} : { slots: { children } }),
  } as BlockNode;
}

function compiled(nodes: BlockNode[], ctx: StyleCompileContext = CTX) {
  return compilePageCss(page(nodes), ctx);
}

describe("a container's own content width", () => {
  it("is written in the container's own rule", () => {
    const { css } = compiled([section("n1", { contentWidth: "1400px" })]);
    expect(css).toContain(
      `${PAGE_ROOT_SELECTOR} .${nodeClassName("n1")} { ${CONTENT_WIDTH_PROPERTY}: 1400px }`
    );
  });

  it("reads the prop the engine names", () => {
    expect(CONTENT_WIDTH_PROP).toBe("contentWidth");
    expect(CONTENT_WIDTH_PROPERTY).toBe("--nx-content-width");
  });

  it("is written on the container alone, not on a container inside it", () => {
    const { css } = compiled([
      section("outer", { contentWidth: "1400px" }, [section("inner", {})]),
    ]);
    expect(css).toContain(
      `.${nodeClassName("outer")} { ${CONTENT_WIDTH_PROPERTY}: 1400px }`
    );
    expect(css).not.toContain(`.${nodeClassName("inner")} {`);
  });

  it("writes a site variable as every token reference is written", () => {
    const { css } = compiled([
      section("n1", { contentWidth: { $token: "content.wide" } }),
    ]);
    expect(css).toContain(
      `{ ${CONTENT_WIDTH_PROPERTY}: var(--site-content-wide) }`
    );
  });

  it("names a variable under the site's token prefix", () => {
    const { css } = compiled(
      [section("n1", { contentWidth: { $token: "content.wide" } })],
      { ...CTX, tokenPrefix: "--brand-" }
    );
    expect(css).toContain(`var(--brand-content-wide)`);
  });

  it.each(["90%", "min(1400px, 100%)", "80rem", " 1200px "])(
    "takes %j as a width",
    value => {
      const { css, warnings } = compiled([
        section("n1", { contentWidth: value }),
      ]);
      expect(css).toContain(`${CONTENT_WIDTH_PROPERTY}: ${value.trim()}`);
      expect(warnings).toEqual([]);
    }
  );

  it.each([
    ["a colour", "red"],
    ["a negative length", "-10px"],
    ["two lengths", "10px 20px"],
    ["a rule break", "1px}body{color:red"],
    ["a number", 1400],
    ["a scaled variable", { $token: "content.wide", times: 2 }],
    ["a variable with a bad name", { $token: "Bad Name" }],
  ])("writes nothing for %s, and says so", (_what, value) => {
    const { css, warnings } = compiled([
      section("n1", { contentWidth: value }),
    ]);
    expect(css).not.toContain(CONTENT_WIDTH_PROPERTY);
    expect(warnings).toEqual([
      expect.objectContaining({
        code: "invalid-style-value",
        path: "/nodes/0/props/contentWidth",
      }),
    ]);
  });

  it.each([undefined, null, ""])("writes nothing, silently, for %j", value => {
    const { css, warnings } = compiled([
      section("n1", { contentWidth: value }),
    ]);
    expect(css).not.toContain(CONTENT_WIDTH_PROPERTY);
    expect(warnings).toEqual([]);
  });

  it("writes nothing for a page that states no width (the bytes are unchanged)", () => {
    const without = compiled([section("n1", {})]).css;
    expect(without).toBe(compiled([section("n1", { other: 1 })]).css);
    expect(without).not.toContain(CONTENT_WIDTH_PROPERTY);
  });

  it("is held out of the sheet with a gated container", () => {
    const gated = {
      ...section("n1", { contentWidth: "1400px" }),
      visibility: {
        conditions: [[{ field: "tier", op: "eq", value: "vip" }]],
      },
    } as unknown as BlockNode;
    const result = compiled([gated]);
    expect(result.css).not.toContain(CONTENT_WIDTH_PROPERTY);
    expect(result.gated?.n1).toContain(`${CONTENT_WIDTH_PROPERTY}: 1400px`);
  });
});
