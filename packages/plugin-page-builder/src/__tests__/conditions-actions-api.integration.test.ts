/**
 * A block's visibility conditions, changed through the API with
 * `set-conditions` on `POST /pages/actions`, judged as an editor save is.
 *
 * What only a server shows: that conditions are set and removed as asked;
 * that the field validation
 * behind every save refuses a condition on a field visitors can't see or
 * the entry lacks, naming the field; and that a dry run answers those
 * refusals without writing.
 *
 * @module __tests__/conditions-actions-api.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { BlockNode } from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import type { PageActionResult } from "../composition-actions-contract";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

import { created, holding, person, post } from "./transfer-harness";

const ARTICLES = "ca_articles";
const AUTHOR = ["read-ca_articles", "update-ca_articles"];

function heading(id: string, extra: Record<string, unknown> = {}): BlockNode {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text: "Members", level: 2 },
    ...extra,
  } as BlockNode;
}

function page(...nodes: BlockNode[]) {
  return { formatVersion: 1, kind: "page", nodes };
}

describe.each(getConfiguredTestDialects())(
  "a block's conditions through the API (%s)",
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
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              text({ name: "tier" }),
              text({ name: "secret", access: { read: () => false } }),
              { name: "content", type: BLOCKS_TYPE } as never,
            ],
          }),
        ],
        seedPublic: true,
      });
      await person(current, "owner");
      return current;
    }

    async function article(t: TestNextly, ...nodes: BlockNode[]) {
      return created(t, ARTICLES, {
        title: "An article",
        content: page(...(nodes.length > 0 ? nodes : [heading("h")])),
      });
    }

    async function storedNode(
      t: TestNextly,
      id: string
    ): Promise<BlockNode | undefined> {
      const row = (await t.nextly.findByID({
        collection: ARTICLES,
        id,
        overrideAccess: true,
        status: "all",
        draft: true,
        depth: 0,
      })) as unknown as { content: { nodes: BlockNode[] } };
      return row.content.nodes.find(node => node.id === "h");
    }

    const change = (
      cookie: string,
      at: { collection: string; id: string },
      conditions: unknown,
      extra: { dryRun?: boolean; nodeId?: string } = {}
    ) =>
      post(cookie, ["pages", "actions"], {
        page: at,
        action: {
          kind: "set-conditions",
          nodeId: extra.nodeId ?? "h",
          conditions,
        },
        ...(extra.dryRun === true ? { dryRun: true } : {}),
      });

    const vip = [[{ field: "tier", op: "equals", value: "vip" }]];

    it("sets conditions, and removes them with null", async () => {
      // The devices a block shows on are kept by the engine's writer, which
      // `visibility-conditions.test.ts` holds; here, what the route stores.
      const t = await boot();
      const id = await article(t);
      const { cookie } = await holding(t, AUTHOR);
      const at = { collection: ARTICLES, id };

      const set = await change(cookie, at, vip);
      expect(set.status).toBe(200);
      expect((await storedNode(t, id))?.visibility).toEqual({
        conditions: vip,
      });

      const removed = await change(cookie, at, null);
      expect(removed.status).toBe(200);
      expect((await storedNode(t, id))?.visibility).toBeUndefined();
    });

    it.each([
      [
        "a field visitors can't see",
        [[{ field: "secret", op: "exists" }]],
        "visitors can't see",
      ],
      [
        "a field the entry lacks",
        [[{ field: "rating", op: "exists" }]],
        '"rating"',
      ],
      [
        "a value the field's kind does not take",
        [[{ field: "tier", op: "greater_than", value: 3 }]],
        '"tier"',
      ],
    ])(
      "refuses %s: the dry run says so, and the apply writes nothing",
      async (_, conditions, says) => {
        const t = await boot();
        const id = await article(t);
        const { cookie } = await holding(t, AUTHOR);
        const at = { collection: ARTICLES, id };

        const dry = await change(cookie, at, conditions, { dryRun: true });
        expect(dry.status).toBe(200);
        const refusals = (dry.body.item as PageActionResult).refusals;
        expect(refusals.join("\n")).toContain(says);

        const applied = await change(cookie, at, conditions);
        expect(applied.status).toBe(422);
        expect((await storedNode(t, id))?.visibility).toBeUndefined();
      }
    );

    it("refuses an operator conditions don't have before reading the page", async () => {
      const t = await boot();
      const id = await article(t);
      const { cookie } = await holding(t, AUTHOR);
      const refused = await change(cookie, { collection: ARTICLES, id }, [
        [{ field: "tier", op: "matches", value: "v" }],
      ]);
      expect(refused.status).toBe(400);
    });

    it("refuses a block the page does not hold", async () => {
      const t = await boot();
      const id = await article(t);
      const { cookie } = await holding(t, AUTHOR);
      const refused = await change(cookie, { collection: ARTICLES, id }, vip, {
        nodeId: "nope",
      });
      expect(refused.status).toBe(422);
    });
  }
);
