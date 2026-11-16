/**
 * Each site renders and judges its own blocks.
 *
 * Two page builders started in one process, each with a custom block of its
 * own: a page is drawn and a save is judged against that site's blocks only,
 * and a second site's start leaves the first's blocks as they were. A public
 * route given no `blocks` draws the site's registered blocks, custom ones
 * included, and a restart with a changed block draws the new one.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { PageRenderer } from "@nextlyhq/blocks-react";
import { createPublicBlocksPage } from "@nextlyhq/blocks-react/next";
import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import { defineBlock } from "@nextlyhq/plugin-sdk/blocks";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { blockRegistry, blocksOf } from "../index";
import { pageBuilder } from "../plugin";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A site's own blocks: a badge it draws, and an item only a box may hold. */
function siteBlocks(site: "a" | "b", text = `Badge ${site.toUpperCase()}`) {
  return [
    defineBlock({
      name: `acme/${site}-badge`,
      version: 1,
      description: `Site ${site}'s badge.`,
      example: { props: {} },
      props: {},
      render: () => createElement("p", { "data-badge": site }, text),
    }),
    defineBlock({
      name: `acme/${site}-box`,
      version: 1,
      description: `Site ${site}'s box.`,
      example: { props: {} },
      props: {},
      slots: { children: {} },
      render: () => null,
    }),
    defineBlock({
      name: `acme/${site}-item`,
      version: 1,
      description: `Site ${site}'s item, held only by its box.`,
      example: { props: {} },
      props: {},
      parent: [`acme/${site}-box`],
      render: () => null,
    }),
  ];
}

/** A plugin adding `blocks` to the site it is installed on, from its init. */
function contributor(blocks: ReturnType<typeof siteBlocks>): PluginDefinition {
  return definePlugin({
    name: "@acme/site-blocks",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: ctx => {
      blockRegistry(ctx).register(blocks);
    },
  });
}

const node = (type: string) => ({ id: type, type, version: 1, props: {} });

/** Both sites' badges on one page. */
const bothBadges = {
  formatVersion: 1,
  kind: "page",
  nodes: [node("acme/a-badge"), node("acme/b-badge")],
};

async function savePage(
  t: TestNextly,
  slug: string,
  content: unknown
): Promise<unknown> {
  return t.nextly.create({
    collection: "pages",
    data: { title: slug, slug, content, status: "published" },
    overrideAccess: true,
  });
}

/** An item placed at the top of a page, outside the box it must sit in. */
const itemAtTop = (site: "a" | "b") => ({
  formatVersion: 1,
  kind: "page",
  nodes: [node(`acme/${site}-item`)],
});

async function streamed(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return new Response(stream).text();
}

/** The page at `slug`, through a public route, with `blocks` if given. */
async function routeHtml(
  t: TestNextly,
  slug: string,
  blocks?: ReturnType<typeof blocksOf>
): Promise<string> {
  const route = createPublicBlocksPage({
    collections: ["pages"],
    field: "content",
    nextly: t.nextly as never,
    ...(blocks === undefined ? {} : { blocks }),
    styleContext: {
      breakpoints: { viewport: [{ id: "base", label: "Desktop" }], container: [] },
    },
  });
  return streamed(
    (await route.ContentPage({ params: { slug: [slug] } })) as ReactElement
  );
}

describe.each(getConfiguredTestDialects())(
  "each site's own blocks (%s)",
  (dialect: TestDialect) => {
    it("two sites started in turn in one process judge and draw their own blocks only", async () => {
      const builderA = pageBuilder();
      const builderB = pageBuilder();

      const a = await createTestNextly({
        dialect,
        plugins: [builderA, contributor(siteBlocks("a"))],
        seedPublic: true,
      });
      current = a;
      // Site A holds its item to its box; site B's item it does not know.
      await expect(savePage(a, "a-item-top", itemAtTop("a"))).rejects.toThrow();
      await savePage(a, "b-item-top", itemAtTop("b"));
      await savePage(a, "badges", bothBadges);
      const drawnByA = await routeHtml(a, "badges", blocksOf(builderA));
      expect(drawnByA).toContain("Badge A");
      expect(drawnByA).not.toContain("Badge B");
      await a.destroy();
      current = undefined;

      const b = await createTestNextly({
        dialect,
        plugins: [builderB, contributor(siteBlocks("b"))],
        seedPublic: true,
      });
      current = b;
      await expect(savePage(b, "b-item-top", itemAtTop("b"))).rejects.toThrow();
      await savePage(b, "a-item-top", itemAtTop("a"));
      await savePage(b, "badges", bothBadges);
      const drawnByB = await routeHtml(b, "badges", blocksOf(builderB));
      expect(drawnByB).toContain("Badge B");
      expect(drawnByB).not.toContain("Badge A");

      // Site B's start left site A's blocks as they were.
      expect(blocksOf(builderA).has("acme/a-badge")).toBe(true);
      expect(blocksOf(builderA).has("acme/b-badge")).toBe(false);
      expect(blocksOf(builderB).has("acme/a-badge")).toBe(false);
      const drawnByAStill = await streamed(
        createElement(PageRenderer, {
          document: bothBadges as never,
          blocks: blocksOf(builderA),
        })
      );
      expect(drawnByAStill).toContain("Badge A");
      expect(drawnByAStill).not.toContain("Badge B");
    });

    it("a public route given no blocks draws the site's custom block, and a restart's new one", async () => {
      const builder = pageBuilder();
      const first = await createTestNextly({
        dialect,
        plugins: [builder, contributor(siteBlocks("a", "Old badge"))],
        seedPublic: true,
      });
      current = first;
      await savePage(first, "badge", {
        formatVersion: 1,
        kind: "page",
        nodes: [node("acme/a-badge")],
      });
      expect(await routeHtml(first, "badge")).toContain("Old badge");
      await first.destroy();
      current = undefined;

      // The same page builder started again with the block changed, as a
      // dev server's reload starts it: the new definition is drawn.
      const second = await createTestNextly({
        dialect,
        plugins: [builder, contributor(siteBlocks("a", "New badge"))],
        seedPublic: true,
      });
      current = second;
      await savePage(second, "badge", {
        formatVersion: 1,
        kind: "page",
        nodes: [node("acme/a-badge")],
      });
      const html = await routeHtml(second, "badge");
      expect(html).toContain("New badge");
      expect(html).not.toContain("Old badge");
    });
  }
);
