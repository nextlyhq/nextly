/**
 * The Page Builder's "never quote this" with the SEO plugin installed too, on
 * every configured dialect: the section's mark is the Page Builder's own, so
 * a page the SEO plugin also answers renders the marked section with
 * `data-nosnippet` exactly as it does without the SEO plugin, and the page
 * keeps its own SEO answer beside it.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createPublicBlocksPage } from "@nextlyhq/blocks-react/next";
import { pageBuilder } from "@nextlyhq/plugin-page-builder";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { seoPlugin } from "../plugin";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

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

describe.each(getConfiguredTestDialects())(
  "a section marked never to be quoted, with the SEO plugin (%s)",
  (dialect: TestDialect) => {
    it("is rendered with data-nosnippet, beside the page's own SEO answer", async () => {
      const t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        seedPublic: true,
        plugins: [
          pageBuilder(),
          seoPlugin({ collections: ["pages"], sitemap: false }),
        ],
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
          seo: { metaTitle: "Pricing | Acme" },
          status: "published",
        },
        overrideAccess: true,
      });

      const route = createPublicBlocksPage({
        collections: ["pages"],
        field: "content",
        nextly: t.nextly as never,
        blocks: createBlockResolver(coreBlocks),
      });
      const html = renderToStaticMarkup(
        (await route.ContentPage({
          params: { slug: ["pricing"] },
        })) as ReactElement
      );
      expect(html).toMatch(
        /<section [^>]*data-nosnippet=""[^>]*><h2[^>]*>Plans from \$29/
      );
      expect(html.match(/data-nosnippet/g)).toHaveLength(1);

      const head = await route.generateMetadata({
        params: { slug: ["pricing"] },
      });
      expect(head.title).toEqual({ absolute: "Pricing | Acme" });
    });
  }
);
