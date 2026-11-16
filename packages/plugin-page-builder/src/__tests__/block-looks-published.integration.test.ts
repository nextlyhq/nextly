/**
 * Block styles on a published page, on every configured dialect: a page whose
 * blocks wear the core blocks' looks (a Section's Hero, a Button's Secondary,
 * Outline and Text, an Image's Rounded and Circle) is rendered by the real
 * route helper with the site style a host loads through the plugin's
 * `loadSiteStyle`, and every look reaches the page as its class on the
 * element and its rule in the page's CSS, as it does on the canvas.
 *
 * @module __tests__/block-looks-published.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createPublicBlocksPage } from "@nextlyhq/blocks-react/next";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";
import type { SiteStyleData } from "../site-style";
import { loadSiteStyle } from "../site-style-load";
import { SITE_STYLE_SLUG } from "../site-style-storage";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** Each look a core block offers, the node wearing it, and its class. */
const WORN = [
  {
    look: "look:core/section:hero",
    className: "nx-l-section-hero",
    // The section's own start tag: the one opening onto its heading.
    wearer: /<section [^>]*>(?=<h2[^>]*>Welcome<)/,
    node: {
      id: "hero",
      type: "core/section",
      version: 1,
      props: { as: "section" },
      slots: {
        children: [
          {
            id: "hero-title",
            type: "core/heading",
            version: 1,
            props: { text: "Welcome", level: "h2" },
          },
        ],
      },
    },
  },
  ...(["secondary", "outline", "text"] as const).map(name => ({
    look: `look:core/button:${name}`,
    className: `nx-l-button-${name}`,
    wearer: new RegExp(`<a [^>]*>(?=Button ${name}<)`),
    node: {
      id: `button-${name}`,
      type: "core/button",
      version: 1,
      props: { label: `Button ${name}`, href: "/signup" },
    },
  })),
  ...(["rounded", "circle"] as const).map(name => ({
    look: `look:core/image:${name}`,
    className: `nx-l-image-${name}`,
    wearer: new RegExp(`<img [^>]*alt="Image ${name}"[^>]*>`),
    node: {
      id: `image-${name}`,
      type: "core/image",
      version: 1,
      props: { src: "/example.jpg", alt: `Image ${name}` },
    },
  })),
];

/** A host's own style defaults: its breakpoints, and no classes of its own. */
const HOST_DEFAULTS = {
  breakpoints: { viewport: [{ id: "base", label: "Desktop" }], container: [] },
} satisfies SiteStyleData;

/**
 * The page: the Hero section first, then a plain section holding the buttons
 * and images, as an author lays them out.
 */
const pageNodes = () => {
  const [hero, ...rest] = WORN.map(each => ({
    ...each.node,
    classes: [each.look],
  }));
  return [
    hero,
    {
      id: "more",
      type: "core/section",
      version: 1,
      props: { as: "section" },
      slots: { children: rest },
    },
  ];
};

async function render(t: TestNextly, slug: string): Promise<string> {
  const route = createPublicBlocksPage({
    collections: ["pages"],
    field: "content",
    nextly: t.nextly as never,
    blocks: createBlockResolver(coreBlocks),
    styleContext: { breakpoints: HOST_DEFAULTS.breakpoints },
    // What a host states: the plugin's published load over its own defaults,
    // which name no look.
    siteStyles: {
      read: () => loadSiteStyle({ nextly: t.nextly, defaults: HOST_DEFAULTS }),
      singles: [SITE_STYLE_SLUG],
    },
  });
  const element = (await route.ContentPage({
    params: { slug: [slug] },
  })) as ReactElement;
  // Streamed to completion: a button resolves its link and an image its
  // picture asynchronously, and a static render keeps only their fallbacks.
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return new Response(stream).text();
}

describe.each(getConfiguredTestDialects())(
  "block styles on a published page (%s)",
  (dialect: TestDialect) => {
    it("reach the page as their class and their rule", async () => {
      const t = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        seedPublic: true,
      });
      current = t;
      await t.nextly.create({
        collection: "pages",
        data: {
          title: "Looks",
          slug: "looks",
          content: {
            formatVersion: 1,
            kind: "page",
            nodes: pageNodes(),
          },
          status: "published",
        },
        overrideAccess: true,
      });

      const html = await render(t, "looks");
      const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
        .map(match => match[1])
        .join("\n");
      for (const { node, className, wearer } of WORN) {
        // The class on the very element the node renders, as a whole token.
        const tag = html.match(wearer)?.[0];
        expect(tag, node.id).toMatch(
          new RegExp(`class="(?:[^"]* )?${className}(?: [^"]*)?"`)
        );
        // And a rule for it in the page's CSS.
        expect(css, className).toMatch(
          new RegExp(`\\.${className}[^{]*\\{[^}]+\\}`)
        );
      }
      // The rule carries the look's own values, not merely its selector.
      expect(css).toMatch(/\.nx-l-section-hero[^{]*\{[^}]*text-align:\s*center/);
      expect(css).toMatch(/\.nx-l-image-circle[^{]*\{[^}]*border-radius:\s*9999px/);
    });
  }
);
