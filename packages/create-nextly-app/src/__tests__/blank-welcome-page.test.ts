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
import { readFileSync } from "node:fs";
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

describe("blank template: the welcome page", () => {
  it("links the guide for building the front end in code", () => {
    const links = guideLinks();
    expect(links).toHaveLength(1);
    expect(attribute(links[0].link, "href")).toBe(GUIDE);
  });

  it("renders the link with Next.js's Link", () => {
    const fromNextLink = program.body.some(
      statement =>
        statement.type === "ImportDeclaration" &&
        statement.source.value === "next/link" &&
        statement.specifiers.some(s => s.local.name === "Link")
    );
    expect(fromNextLink).toBe(true);
  });

  it("puts the link in its own sentence after the introduction", () => {
    const paragraph = guideLinks()[0]?.paragraph;
    expect(paragraph).toBeDefined();
    const written = paragraph ? text.slice(paragraph.start, paragraph.end) : "";
    expect(written).toMatchInlineSnapshot(`
      "<p className="mt-3 mx-auto text-slate-500 dark:text-slate-400 max-w-[42ch] text-[clamp(14px,1.6vw,16px)] leading-[1.6]">
                Then show it on your site:{" "}
                <Link
                  href="https://nextlyhq.com/docs/guides/build-your-front-end-in-code"
                  className="text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground transition-colors"
                >
                  Build your front end in code
                </Link>
                .
              </p>"
    `);
  });
});
