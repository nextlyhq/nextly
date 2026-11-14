/**
 * "Never quote this" on a published page, on every configured dialect: a
 * section marked never to be quoted is rendered with `data-nosnippet` by the
 * real route helper, with the Page Builder alone and no SEO plugin, and one
 * not marked is rendered as it always was. The mark is stored on the page's
 * document and read back as written.
 *
 * @module __tests__/never-quote.integration.test
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
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A section holding one paragraph of text, marked or not. */
const section = (id: string, words: string, nosnippet: boolean) => ({
  id,
  type: "core/section",
  version: 1,
  props: { as: "section" },
  ...(nosnippet ? { nosnippet: true } : {}),
  slots: {
    children: [
      {
        id: `${id}-text`,
        type: "core/heading",
        version: 1,
        props: { text: words, level: "h2" },
      },
    ],
  },
});

async function render(t: TestNextly, slug: string): Promise<string> {
  const route = createPublicBlocksPage({
    collections: ["pages"],
    field: "content",
    nextly: t.nextly as never,
    blocks: createBlockResolver(coreBlocks),
  });
  const element = (await route.ContentPage({
    params: { slug: [slug] },
  })) as ReactElement;
  return renderToStaticMarkup(element);
}

describe.each(getConfiguredTestDialects())(
  "a section marked never to be quoted (%s)",
  (dialect: TestDialect) => {
    it("is rendered with data-nosnippet, with no SEO plugin installed", async () => {
      const t = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        seedPublic: true,
      });
      current = t;
      await t.nextly.create({
        collection: "pages",
        data: {
          title: "Pricing",
          slug: "pricing",
          content: {
            formatVersion: 1,
            kind: "page",
            nodes: [
              section("plans", "Plans from $29", true),
              section("questions", "Questions about pricing", false),
            ],
          },
          status: "published",
        },
        overrideAccess: true,
      });

      const stored = await t.nextly.find({
        collection: "pages",
        where: { slug: { equals: "pricing" } },
        overrideAccess: true,
      });
      const content = (
        stored.items[0] as { content: { nodes: Record<string, unknown>[] } }
      ).content;
      expect(content.nodes[0]?.nosnippet).toBe(true);
      expect(content.nodes[1]).not.toHaveProperty("nosnippet");

      const html = await render(t, "pricing");
      expect(html).toMatch(
        /<section [^>]*data-nosnippet=""[^>]*><h2[^>]*>Plans from \$29/
      );
      expect(html).toMatch(
        /<section (?![^>]*data-nosnippet)[^>]*><h2[^>]*>Questions about pricing/
      );
      expect(html.match(/data-nosnippet/g)).toHaveLength(1);
    });
  }
);
