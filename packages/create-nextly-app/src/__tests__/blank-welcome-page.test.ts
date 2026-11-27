/**
 * The Blank start's welcome page sends the developer on to the guide for
 * writing its pages in code: Blank has no front end of its own, and that guide
 * is where reading the content into pages is explained.
 *
 * The page is read as a syntax tree rather than as text, so only a rendered
 * link counts: a `<Link>` from `next/link` whose text is the guide's name and
 * whose `href` is its address. The same words in a comment or a string do not.
 * It is not rendered here because it is written for a Next.js app, and this
 * package installs no Next.js.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";
import type { Node } from "oxc-parser";
import { describe, expect, it } from "vitest";

const PAGE = fileURLToPath(
  new URL(
    "../../../../templates/blank/src/app/(frontend)/page.tsx",
    import.meta.url
  )
);
/** The repository root, where the docs the site publishes live. */
const REPO = new URL("../../../../", import.meta.url);
const GUIDE = "https://nextlyhq.com/docs/guides/build-your-front-end-in-code";
const GUIDE_NAME = "Build your front end in code";

const text = readFileSync(PAGE, "utf-8");
const { program } = parseSource(text, PAGE);

/** The element's tag, as written: `Link`, `p`. */
function tagOf(node: Node): string | null {
  if (node.type !== "JSXElement") return null;
  const name = node.openingElement.name;
  return name.type === "JSXIdentifier" ? name.name : null;
}

/** The visible text directly inside an element, with JSX's spacing. */
function textInside(node: Node): string {
  if (node.type !== "JSXElement") return "";
  return node.children
    .flatMap(child => (child.type === "JSXText" ? [child.value] : []))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What a reader sees of an element: its text, its children's text, and the
 * strings written as `{" "}`, with JSX's spacing.
 */
function readerText(node: Node): string {
  if (node.type === "JSXText") return node.value;
  if (
    node.type === "JSXExpressionContainer" &&
    node.expression.type === "Literal" &&
    typeof node.expression.value === "string"
  ) {
    return node.expression.value;
  }
  if (node.type !== "JSXElement") return "";
  return node.children
    .map(readerText)
    .join("")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,:;])/g, "$1")
    .trim();
}

/** A string attribute's value, or null when it is absent or not a string. */
function attribute(node: Node, name: string): string | null {
  if (node.type !== "JSXElement") return null;
  for (const attr of node.openingElement.attributes) {
    if (
      attr.type === "JSXAttribute" &&
      attr.name.type === "JSXIdentifier" &&
      attr.name.name === name &&
      attr.value?.type === "Literal" &&
      typeof attr.value.value === "string"
    ) {
      return attr.value.value;
    }
  }
  return null;
}

/** Every `<Link>` naming the guide, with the paragraph it sits in. */
function guideLinks(): { link: Node; paragraph: Node | undefined }[] {
  const found: { link: Node; paragraph: Node | undefined }[] = [];
  walk(program, (node, ancestors) => {
    if (tagOf(node) === "Link" && textInside(node) === GUIDE_NAME) {
      found.push({
        link: node,
        paragraph: [...ancestors].reverse().find(a => tagOf(a) === "p"),
      });
    }
  });
  return found;
}

/** The page's paragraphs, in source order. */
function paragraphs(): Node[] {
  const found: Node[] = [];
  walk(program, node => {
    if (tagOf(node) === "p") found.push(node);
  });
  return found.sort((a, b) => a.start - b.start);
}

describe("blank template: the welcome page", () => {
  it("links the guide for building the front end in code, with Next.js's Link", () => {
    const links = guideLinks();
    expect(links).toHaveLength(1);
    expect(attribute(links[0].link, "href")).toBe(GUIDE);
    // The element is Next.js's Link, not some other component of that name.
    const fromNextLink = program.body.some(
      statement =>
        statement.type === "ImportDeclaration" &&
        statement.source.value === "next/link" &&
        statement.specifiers.some(s => s.local.name === "Link")
    );
    expect(fromNextLink).toBe(true);
  });

  it("links an address the docs publish a page at", () => {
    // Read from the page, so a renamed or moved guide fails here rather than
    // sending every new project to a missing page.
    const href = attribute(guideLinks()[0]?.link ?? program, "href") ?? "";
    const address = new URL(href);
    expect(address.origin).toBe("https://nextlyhq.com");
    expect(address.pathname.startsWith("/docs/")).toBe(true);
    const page = new URL(`.${address.pathname}.mdx`, REPO);
    expect(existsSync(page)).toBe(true);
  });

  it("puts the link in its own sentence, after the introduction", () => {
    const paragraph = guideLinks()[0]?.paragraph;
    expect(paragraph).toBeDefined();
    if (!paragraph) return;
    expect(readerText(paragraph)).toBe(
      `Then show it on your site: ${GUIDE_NAME}.`
    );
    const order = paragraphs();
    const intro = order.findIndex(p =>
      readerText(p).startsWith("This is the blank template.")
    );
    expect(intro).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(paragraph)).toBe(intro + 1);
  });
});
