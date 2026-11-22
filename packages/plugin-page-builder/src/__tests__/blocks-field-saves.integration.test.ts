/**
 * A blocks field saves a page drawn from the site's core blocks, on a Single
 * and on a collection alike, judged against the site's own block registry and
 * under the limits the site configured.
 */
import { DEFAULT_LIMITS, type DocumentLimits } from "@nextlyhq/blocks-engine";
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

/** Boxes nested `depth` deep, a heading in the innermost. */
function nestedPage(depth: number) {
  let nodes: Record<string, unknown>[] = [
    { id: "h", type: "core/heading", version: 1, props: { text: "Hi" } },
  ];
  for (let level = depth - 1; level >= 1; level--) {
    nodes = [
      {
        id: `box${level}`,
        type: "core/box",
        version: 1,
        props: {},
        slots: { children: nodes },
      },
    ];
  }
  return { formatVersion: 1, kind: "page", nodes };
}

/** The issue codes a refused write carries. */
function codesOf(error: unknown): string[] {
  const errors =
    (error as { publicData?: { errors?: { code: string }[] } }).publicData
      ?.errors ?? [];
  return errors.map(issue => issue.code);
}

describe.each(getConfiguredTestDialects())(
  "a page save under the limits the site configured (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function save(limits: DocumentLimits, depth: number) {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder({ limits })],
      });
      return current.nextly.create({
        collection: "pages",
        data: { title: "Deep", slug: "deep", content: nestedPage(depth) },
        overrideAccess: true,
      });
    }

    it("refuses a page deeper than the tighter depth the site set", async () => {
      const refused = await save({ ...DEFAULT_LIMITS, maxDepth: 4 }, 5).then(
        () => undefined,
        (error: unknown) => error
      );
      expect(refused, "the save was accepted").toBeDefined();
      expect(codesOf(refused)).toContain("depth-exceeded");
    });

    it("saves a page past the default depth that the site's looser depth allows", async () => {
      const depth = DEFAULT_LIMITS.maxDepth + 2;
      const made = await save(
        { ...DEFAULT_LIMITS, maxDepth: depth + 2 },
        depth
      );
      expect(made.item.id).toBeDefined();
    });
  }
);
