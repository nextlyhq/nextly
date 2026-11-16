/**
 * The page's first section draws its background from copies sized to each
 * device, and the page's head names them, so the browser fetches the right
 * copy from the HTML before the stylesheet arrives.
 *
 * Rendered through the page renderer inside a whole document, with the
 * context a route builds: the slot each device draws comes from the site's
 * breakpoints, and the copies from a stub of the site's media.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandaloneContext } from "../context";
import { imageSizingFor, type ImageCopy } from "../image-slot";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";
import { coreBlocks } from "./index";

const BREAKPOINTS = {
  viewport: [
    { id: "base", label: "Desktop" },
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
};

/** The widths a site keeps copies at, as core media does. */
const KEPT = [96, 160, 240, 320, 640, 960, 1280, 1920];

const PHOTO = "/media/hero.jpg";

const section = (
  id: string,
  styles?: BlockNode["styles"],
  extra: Partial<BlockNode> = {}
): BlockNode => ({
  id,
  type: "core/section",
  version: 1,
  props: {},
  ...(styles === undefined ? {} : { styles }),
  slots: { children: [] },
  ...extra,
});

const withBackground = (url: string = PHOTO): BlockNode["styles"] => ({
  base: { base: { background: { url, size: "cover" } } },
});

async function render(
  nodes: BlockNode[],
  options: { copies?: boolean; scope?: string } = {}
): Promise<{ head: string; html: string; asked: unknown[] }> {
  const asked: unknown[] = [];
  const document: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  };
  const context = {
    ...createStandaloneContext(),
    ...imageSizingFor(
      options.copies === false
        ? undefined
        : async (source, upTo): Promise<readonly ImageCopy[]> => {
            asked.push(source);
            if (!("url" in source) || !source.url.startsWith("/media/hero")) {
              return [];
            }
            return KEPT.filter(width => width <= upTo).map(width => ({
              url: `${source.url.replace(/\.jpg$/, "")}-${width}.webp`,
              width,
            }));
          },
      BREAKPOINTS,
      nodes
    ),
  };
  const stream = await renderToReadableStream(
    <html>
      <head />
      <body>
        <PageRenderer
          document={document}
          blocks={createBlockResolver(coreBlocks)}
          siteStyles={false}
          styleContext={{
            breakpoints: BREAKPOINTS,
            ...(options.scope === undefined ? {} : { scope: options.scope }),
          }}
          context={context}
        />
      </body>
    </html>,
    {
      onError(error) {
        throw error;
      },
    }
  );
  await stream.allReady;
  const html = await new Response(stream).text();
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
  return { head, html, asked };
}

/** Every `<link rel="preload">` in the head, as its attributes. */
function preloadsOf(head: string): Record<string, string>[] {
  return [...head.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) =>
      Object.fromEntries(
        // Attribute names are case-insensitive in HTML, and React writes
        // `fetchPriority` in camel case.
        [...tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map(([, name, value]) => [
          name.toLowerCase(),
          value.replaceAll("&lt;", "<").replaceAll("&gt;", ">"),
        ])
      )
    )
    .filter(link => link.rel === "preload");
}

/** The section's own class: the first class on the element it draws. */
function nodeClassIn(html: string): string {
  return /<div class="(nx-pb-(?!page)[a-z0-9]+) /.exec(html)?.[1] ?? "";
}

describe("the first section's background", () => {
  it("is named in the head with the copy each device draws", async () => {
    const { head } = await render([section("hero", withBackground())]);
    // Twice each device's width: a desktop (1920) and a tablet (1024) want
    // more than the widest copy, so both draw it; a phone (640) draws 1280.
    expect(preloadsOf(head)).toEqual([
      {
        rel: "preload",
        as: "image",
        href: "/media/hero-1920.webp",
        fetchpriority: "high",
        media: "(width > 1024px), (640px < width <= 1024px)",
      },
      {
        rel: "preload",
        as: "image",
        href: "/media/hero-1280.webp",
        fetchpriority: "high",
        media: "(width <= 640px)",
      },
    ]);
  });

  it("draws each device's copy, one notch above the block's own rule", async () => {
    const { head, html } = await render([section("hero", withBackground())]);
    const own = nodeClassIn(html);
    const anchor = `.nx-pb-page.nx-pb-page .${own}.${own}`;
    // The page's own rule still names the original, under the plain anchor.
    expect(own).not.toBe("");
    expect(html).toContain(`.nx-pb-page.nx-pb-page .${own} {`);
    expect(html).toContain(`url("${PHOTO}")`);
    const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(head)?.[1] ?? "";
    expect(style.replaceAll("&quot;", '"').split("\n")).toEqual([
      `${anchor}{background-image:var(--nx-pb-overlay-layer,) url("/media/hero-1920.webp")}`,
      `@media (max-width: 1024px){${anchor}{background-image:var(--nx-pb-overlay-layer,) url("/media/hero-1920.webp")}}`,
      `@media (max-width: 640px){${anchor}{background-image:var(--nx-pb-overlay-layer,) url("/media/hero-1280.webp")}}`,
    ]);
  });

  it("is anchored under the page's scope where its rules are scoped", async () => {
    const { head, html } = await render([section("hero", withBackground())], {
      scope: "nx-pb-part-page",
    });
    const own = nodeClassIn(html);
    expect(html).toContain(`.nx-pb-page.nx-pb-page.nx-pb-part-page .${own} {`);
    expect(head).toContain(
      `.nx-pb-page.nx-pb-page.nx-pb-part-page .${own}.${own}{`
    );
  });

  it("is left to the page's stylesheet where it is not stated once", async () => {
    const cases: BlockNode[][] = [
      // Not the first block.
      [section("intro"), section("hero", withBackground())],
      // Changed at a breakpoint.
      [
        section("hero", {
          base: {
            base: { background: { url: PHOTO } },
            mobile: { background: { url: "/media/other.jpg" } },
          },
        }),
      ],
      // Changed on hover.
      [
        section("hero", {
          base: { base: { background: { url: PHOTO } } },
          hover: { base: { background: { url: "/media/other.jpg" } } },
        }),
      ],
      // Layered with a gradient.
      [
        section("hero", {
          base: {
            base: {
              background: { url: PHOTO },
              backgroundGradient: "linear-gradient(red, blue)",
            },
          },
        }),
      ],
      // Beside custom CSS.
      [section("hero", withBackground(), { customCss: "color: red;" })],
      // Drawn at the image's own size, which a narrower copy would shrink.
      [section("hero", { base: { base: { background: { url: PHOTO } } } })],
      [
        section("hero", {
          base: { base: { background: { url: PHOTO, size: "auto" } } },
        }),
      ],
      [
        section("hero", {
          base: { base: { background: { url: PHOTO, size: "auto auto" } } },
        }),
      ],
      // Its width set by its height and the image's proportions.
      [
        section("hero", {
          base: { base: { background: { url: PHOTO, size: "auto 480px" } } },
        }),
      ],
    ];
    for (const nodes of cases) {
      const { head } = await render(nodes);
      expect(preloadsOf(head)).toEqual([]);
      expect(head).not.toContain("background-image");
    }
  });

  it("is sized wherever the box sets the image's size", async () => {
    for (const size of ["contain", "100% auto", "50%", "300px 200px"]) {
      const { head } = await render([
        section("hero", {
          base: { base: { background: { url: PHOTO, size } } },
        }),
      ]);
      // How many copies depends on the width drawn; every size here has one.
      expect(preloadsOf(head).length, size).toBeGreaterThan(0);
    }
  });

  it("is sized by the width it is drawn at, wider than its box or not", async () => {
    // 2000px wide on every device: twice that is past every copy, so each
    // device draws the widest the site keeps, one copy for all.
    const { head } = await render([
      section("hero", {
        base: { base: { background: { url: PHOTO, size: "2000px auto" } } },
      }),
    ]);
    expect(preloadsOf(head).map(link => link.href)).toEqual([
      "/media/hero-1920.webp",
    ]);
    // A quarter of the box: 480 on a desktop, 256 on a tablet, 160 on a phone.
    const quarter = await render([
      section("hero", {
        base: { base: { background: { url: PHOTO, size: "25%" } } },
      }),
    ]);
    expect(preloadsOf(quarter.head).map(link => link.href)).toEqual([
      "/media/hero-960.webp",
      "/media/hero-640.webp",
      "/media/hero-320.webp",
    ]);
  });

  it("names its rules by what they say, so changed rules replace the old", async () => {
    const hrefOf = async (url: string): Promise<string> => {
      const { head } = await render([section("hero", withBackground(url))]);
      return /<style[^>]*data-href="([^"]+)"/.exec(head)?.[1] ?? "";
    };
    const first = await hrefOf(PHOTO);
    expect(first).toMatch(/^nx-pb-sized-background-/);
    expect(await hrefOf(PHOTO)).toBe(first);
    expect(await hrefOf("/media/hero-other.jpg")).not.toBe(first);
  });

  it("is drawn as it is where no copy can be had", async () => {
    // A site that offers no copies, and an address on another host.
    for (const [nodes, options] of [
      [[section("hero", withBackground())], { copies: false }],
      [[section("hero", withBackground("https://cdn.example.com/a.jpg"))], {}],
    ] as const) {
      const { head, html, asked } = await render([...nodes], options);
      expect(preloadsOf(head)).toEqual([]);
      expect(head).not.toContain("background-image");
      expect(asked).toEqual([]);
      if (options.copies === false) {
        expect(html).toContain(`url("${PHOTO}")`);
      }
    }
  });
});
