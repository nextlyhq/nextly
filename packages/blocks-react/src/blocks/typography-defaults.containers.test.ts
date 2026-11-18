/**
 * A container's text colour and type, on the published path: a dark Section
 * with white text holding a Heading, a Text with a link in it and a List,
 * rendered to the HTML a server sends, with the site's Links row unset and
 * then set.
 *
 * jsdom resolves no stylesheet, so this reads what decides the colours: which
 * element the Section's rule lands on, that each block inside is a
 * descendant of it and declares no colour of its own, and which rule colours
 * the link. The computed colours are measured in a browser, on the canvas and
 * on the live page, by the e2e suite's container text spec.
 */
import type { BlockDocument, SiteTextMap } from "@nextlyhq/blocks-engine";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";

import { coreBlocks } from "./index";

const breakpoints = { viewport: [], container: [] };

const linked = {
  root: {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", text: "Read " },
          {
            type: "link",
            url: "/more",
            children: [{ type: "text", text: "more" }],
          },
        ],
      },
    ],
  },
};

const DARK_SECTION = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "dark",
      type: "core/section",
      version: 1,
      props: { as: "section", contained: true },
      styles: {
        base: { base: { backgroundColor: "#111827", color: "#ffffff" } },
      },
      slots: {
        children: [
          {
            id: "title",
            type: "core/heading",
            version: 1,
            props: { text: "A title", level: "h2" },
          },
          {
            id: "words",
            type: "core/text",
            version: 2,
            props: { text: linked },
          },
          {
            id: "points",
            type: "core/list",
            version: 1,
            props: { items: ["One", "Two"] },
          },
        ],
      },
    },
  ],
} as unknown as BlockDocument;

/** The page as a server sends it, and its stylesheet's text. */
function published(siteText?: SiteTextMap): { html: string; css: string } {
  const html = renderToStaticMarkup(
    createElement(PageRenderer, {
      document: DARK_SECTION,
      blocks: createBlockResolver(coreBlocks),
      styleContext: { breakpoints, ...(siteText ? { siteText } : {}) },
    })
  );
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map(match => match[1])
    .join("\n");
  return { html, css };
}

/** The class the compiler gave a node, read off the rule carrying its colour. */
function sectionClass(css: string): string {
  const match =
    /\.nx-pb-page\.nx-pb-page \.(nx-pb-[a-z0-9]+) \{[^}]*color: #ffffff/.exec(
      css
    );
  if (match?.[1] === undefined) throw new Error("no rule colours the Section");
  return match[1];
}

/** The markup inside the element carrying `className`. */
function inside(html: string, className: string): string {
  const open = new RegExp(
    `<section[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`
  );
  const start = open.exec(html);
  if (start === null) throw new Error(`no element carries ${className}`);
  const end = html.indexOf("</section>", start.index);
  return html.slice(start.index + start[0].length, end);
}

describe("a dark Section with white text, on the published path", () => {
  it("holds the Heading, the Text, its link and the List, and colours none of them itself", () => {
    const { html, css } = published();
    const held = inside(html, sectionClass(css));
    expect(held).toMatch(/<h2[^>]*>A title<\/h2>/);
    expect(held).toMatch(/<p[^>]*>Read <a href="\/more"[^>]*>more<\/a><\/p>/);
    expect(held).toMatch(/<ul[^>]*>.*<li[^>]*>One<\/li>/);
    // Nothing gives a heading, a paragraph or a list a colour of its own, so
    // each inherits the Section's.
    expect(css).not.toMatch(/(h2|p|ul|li)\)? \{[^}]*\bcolor:/);
  });

  it("makes the link take the Section's colour while the Links row sets none", () => {
    const { css } = published();
    const own = `.nx-pb-page.nx-pb-page .${sectionClass(css)}`;
    expect(css).toContain(`:where(${own} a) { color: inherit }`);
    expect(css).not.toMatch(/:where\(a\) \{[^}]*color/);
  });

  it("leaves the link to the Links row's colour once the row sets one", () => {
    const { css } = published({ link: { color: "#ffcc00" } });
    expect(css).toMatch(/:where\(a\) \{ color: #ffcc00 \}/);
    expect(css).not.toContain(" a) { color: inherit }");
    // The rest of the Section is still white.
    expect(sectionClass(css)).not.toBe("");
  });
});

describe("the containers", () => {
  const CONTAINERS = [
    "core/section",
    "core/box",
    "core/columns",
    "core/column",
    "core/card",
    "core/accordion",
    "core/accordion-item",
    "core/gallery",
    "core/collection-loop",
  ];

  it("each offer a text colour and typography for the blocks inside", () => {
    for (const name of CONTAINERS) {
      const block = coreBlocks.find(each => each.name === name);
      expect(block, name).toBeDefined();
      const supports = (block?.supports ?? {}) as Record<string, unknown>;
      expect([name, supports.color, supports.typography]).toEqual([
        name,
        true,
        true,
      ]);
    }
  });
});
