// @vitest-environment jsdom
/**
 * Which element a wrapped image's corners and proportion land on, and in
 * what order the tiers that set them are written.
 *
 * The page is rendered and its sheet compiled as a visitor receives them, and
 * the DOM answers which rules match: the picture must match every tier's
 * corner rule, look first, then the shared style, then the node's own, all of
 * one weight; the figure or link around it must match none, so a caption, or
 * a framing style's box, is never rounded or squared by them.
 *
 * @module blocks/image-routing.test
 */
import { renderToReadableStream } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import {
  blockLooks,
  type BlockDocument,
  type NamedClass,
} from "@nextlyhq/blocks-engine";

import { PageRenderer } from "../page-renderer";
import type { BlockResolver } from "../resolver";

import { coreBlocks } from "./index";

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

const resolver: BlockResolver = {
  get: (name: string) => coreBlocks.find(block => block.name === name) as never,
};
const circle = blockLooks(coreBlocks).find(
  look => look.id === "look:core/image:circle"
) as NamedClass;
const framed: NamedClass = {
  id: "c-framed",
  slug: "framed",
  orderIndex: 0,
  styles: {
    base: { base: { borderRadius: "4px", backgroundColor: "#eef2ff" } },
  } as never,
};

const BREAKPOINTS = {
  viewport: [{ id: "base", label: "Desktop" }],
  container: [],
};

/** The page drawn with one image wearing Circle and Framed, its own corner 0. */
async function page(
  props: Record<string, unknown>,
  via: "styleContext" | "siteStyles" = "styleContext"
): Promise<Document> {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "n1",
        type: "core/image",
        version: 1,
        props: {
          src: "https://example.test/team.png",
          alt: "The team",
          ...props,
        },
        classes: [circle.id, framed.id],
        styles: { base: { base: { borderRadius: "0" } } },
      },
    ],
  } as unknown as BlockDocument;
  const html = await renderToHtml(
    <PageRenderer
      document={document}
      blocks={resolver}
      // The site's classes reach a page two ways: in the compile context, or
      // in the site sheet every page shares, as the canvas and the published
      // routes pass them. Both must route.
      {...(via === "styleContext"
        ? {
            styleContext: {
              breakpoints: BREAKPOINTS,
              namedClasses: [circle, framed],
            },
          }
        : {
            siteStyles: {
              breakpoints: BREAKPOINTS,
              classes: [circle, framed],
            },
          })}
    />
  );
  return new DOMParser().parseFromString(html, "text/html");
}

/** Every rule of the page's sheets, as selector and body, in order. */
function rulesIn(doc: Document): { selector: string; body: string }[] {
  const css = [...doc.querySelectorAll("style")]
    .map(style => style.textContent ?? "")
    .join("\n");
  return [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(match => ({
    selector: (match[1] ?? "").trim(),
    body: (match[2] ?? "").trim(),
  }));
}

/** Which tier wrote a rule, read off the class it is written on. */
function tierOf(selector: string): string {
  if (selector.includes(".nx-l-image-circle")) return "look";
  if (selector.includes(".nx-c-framed")) return "shared";
  if (/\.nx-pb-(?!page)[a-z0-9]+/.test(selector)) return "own";
  return "default";
}

/** The tiers whose rule setting `property` matches `element`, in order. */
function tiersSetting(
  doc: Document,
  element: Element | null,
  property: RegExp
): string[] {
  if (element === null) throw new Error("no element");
  return (
    rulesIn(doc)
      .filter(rule => property.test(rule.body))
      .filter(rule => {
        try {
          return element.matches(rule.selector);
        } catch {
          return false;
        }
      })
      .map(rule => tierOf(rule.selector))
      // Each tier by its LAST matching rule, the one the cascade keeps: the
      // site's classes can be written in the shared sheet and again in the
      // page's, with the same values, and only the later copy decides.
      .filter((tier, index, all) => all.lastIndexOf(tier) === index)
  );
}

const RADIUS = /border(-[a-z]+)*-radius/;
const RATIO = /aspect-ratio/;

describe("a wrapped image's corners and proportion", () => {
  for (const via of ["styleContext", "siteStyles"] as const)
    for (const [name, props, wrapper] of [
      ["captioned", { caption: "Our team" }, "figure"],
      ["linked", { href: "/about" }, "a"],
      [
        "captioned and linked",
        { caption: "Our team", href: "/about" },
        "figure",
      ],
    ] as const) {
      it(`land on the picture from every tier, in the tiers' order, when ${name} (classes in ${via})`, async () => {
        const doc = await page(props, via);
        const picture = doc.querySelector("img");
        expect(tiersSetting(doc, picture, RADIUS)).toEqual([
          "look",
          "shared",
          "own",
        ]);
        expect(tiersSetting(doc, picture, RATIO)).toEqual(["look"]);
      });

      it(`never land on the ${wrapper} around the picture, when ${name} (classes in ${via})`, async () => {
        const doc = await page(props, via);
        const root = doc.querySelector(`.nx-pb-page ${wrapper}`);
        expect(tiersSetting(doc, root, RADIUS)).toEqual([]);
        expect(tiersSetting(doc, root, RATIO)).toEqual([]);
        // What no part takes stays on the root: the framing background.
        expect(tiersSetting(doc, root, /background-color/)).toEqual(["shared"]);
      });
    }

  it("land on the picture itself when it is the root", async () => {
    const doc = await page({});
    expect(tiersSetting(doc, doc.querySelector("img"), RADIUS)).toEqual([
      "look",
      "shared",
      "own",
    ]);
  });
});
