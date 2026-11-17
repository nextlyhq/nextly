/**
 * A blocks field saves a page drawn from the site's core blocks, on a Single
 * and on a collection alike, judged against the site's own block registry.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, defineSingle } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { blocks } from "../fields/blocksHelper";
import { pageBuilder } from "../plugin";

const HOME = "bfs_home";
const ARTICLES = "bfs_articles";

/** A page holding one core text block. */
const PAGE = {
  formatVersion: 1,
  kind: "page",
  nodes: [
    {
      id: "t1",
      type: "core/text",
      version: 1,
      props: { text: "Hello" },
    },
  ],
};

/** The block types a saved blocks value holds, in order. */
function typesIn(value: unknown): string[] {
  const nodes = (value as { nodes?: { type?: unknown }[] } | null)?.nodes;
  return (nodes ?? []).map(node => String(node.type));
}

describe.each(getConfiguredTestDialects())(
  "a blocks field saving core blocks (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        collections: [
          defineCollection({
            slug: ARTICLES,
            fields: [blocks({ name: "body", blocks: { allow: ["core/*"] } })],
          }),
        ],
        singles: [
          defineSingle({
            slug: HOME,
            fields: [blocks({ name: "layout", blocks: { allow: ["core/*"] } })],
          }),
        ],
      });
      return current;
    }

    it("saves a core block on a Single", async () => {
      const t = await boot();
      await t.nextly.updateSingle({
        slug: HOME,
        data: { layout: PAGE, _overwrite: true },
        overrideAccess: true,
      });
      const read = (await t.nextly.findSingle({
        slug: HOME,
        overrideAccess: true,
      })) as { layout?: { nodes?: { type: string }[] } } | null;
      expect(read?.layout?.nodes?.map(node => node.type)).toEqual([
        "core/text",
      ]);
    });

    it("saves a core block on a page, the page builder's own collection", async () => {
      const t = await boot();
      const made = await t.nextly.create({
        collection: "pages",
        data: { title: "Home", slug: "home", content: PAGE },
        overrideAccess: true,
      });
      expect(made.item.id).toBeDefined();
      const read = await t.nextly.findByID({
        collection: "pages",
        id: String(made.item.id),
        overrideAccess: true,
      });
      expect(typesIn((read as { content?: unknown }).content)).toEqual([
        "core/text",
      ]);
    });

    it("saves a core block on a collection entry", async () => {
      const t = await boot();
      const made = await t.nextly.create({
        collection: ARTICLES,
        data: { body: PAGE },
        overrideAccess: true,
      });
      expect(made.item.id).toBeDefined();
      const read = await t.nextly.findByID({
        collection: ARTICLES,
        id: String(made.item.id),
        overrideAccess: true,
      });
      expect(typesIn((read as { body?: unknown }).body)).toEqual(["core/text"]);
    });
  }
);
