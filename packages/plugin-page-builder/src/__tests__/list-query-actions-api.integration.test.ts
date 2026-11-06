/**
 * A collection list's query, changed through the API with `set-list-query`
 * on `POST /pages/actions`, judged as an editor save is.
 *
 * What only a server shows: that each part of a query is set, removed and
 * kept as asked; that the field validation behind every save refuses the
 * same bounds, fields and nesting the editor's save is refused for, naming
 * the field; that a dry run answers those refusals without writing; and that
 * the write carries the version the page was read at, so a save landing in
 * between refuses it rather than being overwritten.
 *
 * @module __tests__/list-query-actions-api.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import type { BlockNode } from "@nextlyhq/blocks-engine";
import { getCachedNextly } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, number, relationship, text } from "nextly/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ListQueryChange,
  PageActionResult,
} from "../composition-actions-contract";
import { asOverwrite } from "../document-version";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

import { created, holding, person, post, unique } from "./transfer-harness";

const AUTHOR = [
  "read-pages",
  "update-pages",
  "read-lq_articles",
  "update-lq_articles",
];

const CATS = "lq_cats";
const ARTICLES = "lq_articles";

function list(
  id: string,
  props: Record<string, unknown>,
  children: BlockNode[] = []
): BlockNode {
  return {
    id,
    type: "core/collection-loop",
    version: 1,
    props,
    slots: { children },
  };
}

function page(...nodes: BlockNode[]) {
  return { formatVersion: 1, kind: "page", nodes };
}

describe.each(getConfiguredTestDialects())(
  "a collection list's query through the API (%s)",
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
            slug: CATS,
            access: { read: () => true },
            fields: [
              text({ name: "name" }),
              text({ name: "secret", access: { read: () => false } }),
              relationship({
                name: "featured",
                relationTo: ARTICLES,
                hasMany: true,
              }),
              relationship({ name: "lead", relationTo: ARTICLES }),
              number({ name: "rank" }),
            ],
          }),
          defineCollection({
            slug: ARTICLES,
            labels: { singular: "Article", plural: "Articles" },
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              relationship({
                name: "categories",
                relationTo: CATS,
                hasMany: true,
              }),
              { name: "content", type: BLOCKS_TYPE } as never,
            ],
          }),
        ],
        seedPublic: true,
      });
      await person(current, "owner");
      return current;
    }

    async function storedList(
      t: TestNextly,
      collection: string,
      id: string,
      listId = "list"
    ): Promise<BlockNode | undefined> {
      const row = (await t.nextly.findByID({
        collection,
        id,
        overrideAccess: true,
        status: "all",
        draft: true,
        depth: 0,
      })) as unknown as { content: { nodes: BlockNode[] } };
      const stack = [...row.content.nodes];
      for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
        if (node.id === listId) return node;
        stack.push(...Object.values(node.slots ?? {}).flat());
      }
      return undefined;
    }

    async function homePage(t: TestNextly, ...nodes: BlockNode[]) {
      return created(t, "pages", {
        title: "Home",
        slug: unique("home"),
        content: page(
          ...(nodes.length > 0 ? nodes : [list("list", { collection: CATS })])
        ),
      });
    }

    const change = (
      cookie: string,
      at: { collection: string; id: string },
      query: ListQueryChange,
      extra: { dryRun?: boolean; listId?: string } = {}
    ) =>
      post(cookie, ["pages", "actions"], {
        page: at,
        action: {
          kind: "set-list-query",
          listId: extra.listId ?? "list",
          query,
        },
        ...(extra.dryRun === true ? { dryRun: true } : {}),
      });

    it("sets filters, sort, limit and offset, and removes a part given as null", async () => {
      const t = await boot();
      const id = await homePage(t);
      const { cookie } = await holding(t, AUTHOR);
      const at = { collection: "pages", id };

      const set = await change(cookie, at, {
        filters: [{ field: "name", op: "contains", value: "é" }],
        sort: "-name,createdAt",
        limit: 5,
        offset: 2,
      });
      expect(set.status).toBe(200);
      expect((set.body.item as PageActionResult).ops).toEqual([
        expect.objectContaining({ kind: "update", id: "list" }),
      ]);
      expect((await storedList(t, "pages", id))?.props).toEqual({
        collection: CATS,
        filters: [{ field: "name", op: "contains", value: "é" }],
        sort: "-name,createdAt",
        limit: 5,
        offset: 2,
      });

      const removed = await change(cookie, at, { sort: null, offset: null });
      expect(removed.status).toBe(200);
      expect((await storedList(t, "pages", id))?.props).toEqual({
        collection: CATS,
        filters: [{ field: "name", op: "contains", value: "é" }],
        limit: 5,
      });
    });

    it("sets a related source of the page's entry", async () => {
      const t = await boot();
      const id = await created(t, ARTICLES, {
        title: "A post",
        content: page(list("list", {})),
      });
      const { cookie } = await holding(t, AUTHOR);

      const set = await change(
        cookie,
        { collection: ARTICLES, id },
        {
          collection: CATS,
          relation: { of: "entry", field: "categories" },
          sort: "name",
        }
      );
      expect(set.status).toBe(200);
      expect((await storedList(t, ARTICLES, id))?.props).toEqual({
        collection: CATS,
        relation: { of: "entry", field: "categories" },
        sort: "name",
      });
    });

    it.each<[string, ListQueryChange, string]>([
      [
        "an offset of -1",
        { offset: -1 },
        "Skip a whole number of entries, 0 or more",
      ],
      ["a limit of 0", { limit: 0 }, "Show between 1 and 100 entries"],
      ["a limit of 101", { limit: 101 }, "Show between 1 and 100 entries"],
      [
        "a sort on a field the collection lacks",
        { sort: "-rating" },
        '"rating"',
      ],
      [
        "a filter on a field the collection lacks",
        { filters: [{ field: "readingTime", op: "less_than", value: 5 }] },
        '"readingTime"',
      ],
      [
        "a sort on a field visitors can't see",
        { sort: "secret" },
        "visitors can't see",
      ],
      [
        "a filter on a field visitors can't see",
        { filters: [{ field: "secret", op: "exists", value: true }] },
        "visitors can't see",
      ],
      [
        "a filter on a relation holding several entries",
        { filters: [{ field: "featured", op: "in", value: ["x"] }] },
        "cannot filter by such a field",
      ],
      ["a sort on a related entry", { sort: "lead" }, "links to another entry"],
      [
        "a number filter compared with text",
        { filters: [{ field: "rank", op: "equals", value: "5" }] },
        'which holds a number, with "5"',
      ],
    ])(
      "refuses %s: the dry run says so, and the apply writes nothing",
      async (_, query, says) => {
        const t = await boot();
        const id = await homePage(t);
        const { cookie } = await holding(t, AUTHOR);
        const at = { collection: "pages", id };

        const dry = await change(cookie, at, query, { dryRun: true });
        expect(dry.status).toBe(200);
        const refusals = (dry.body.item as PageActionResult).refusals;
        expect(refusals.join("\n")).toContain(says);

        const applied = await change(cookie, at, query);
        expect(applied.status).toBe(422);
        expect((await storedList(t, "pages", id))?.props).toEqual({
          collection: CATS,
        });
      }
    );

    it("names a collection in a refusal as authors read it", async () => {
      const t = await boot();
      const id = await homePage(t);
      const { cookie } = await holding(t, AUTHOR);
      const dry = await change(
        cookie,
        { collection: "pages", id },
        { collection: ARTICLES, sort: "-rating" },
        { dryRun: true }
      );
      // The plural name the editor's Source menu shows, never the slug.
      expect((dry.body.item as PageActionResult).refusals.join("\n")).toContain(
        'This list sorts by "rating", which Articles doesn\'t have. Choose another field.'
      );
    });

    it("refuses a related list nested a third level deep", async () => {
      const t = await boot();
      const id = await homePage(
        t,
        list("articles", { collection: ARTICLES }, [
          list(
            "cats",
            {
              collection: CATS,
              relation: { of: "item", field: "categories" },
            },
            [list("list", {})]
          ),
        ])
      );
      const { cookie } = await holding(t, AUTHOR);
      const at = { collection: "pages", id };
      const query: ListQueryChange = {
        collection: ARTICLES,
        relation: { of: "item", field: "featured" },
      };

      const dry = await change(cookie, at, query, { dryRun: true });
      expect((dry.body.item as PageActionResult).refusals.join("\n")).toContain(
        "Too deep for a related field"
      );
      const applied = await change(cookie, at, query);
      expect(applied.status).toBe(422);
    });

    it("refuses a write when the page is saved between its read and its write, and writes once read again", async () => {
      const t = await boot();
      const id = await homePage(t);
      const { cookie } = await holding(t, AUTHOR);
      const at = { collection: "pages", id };
      // Someone else's save lands just after the action reads the page, so
      // the action plans from the older page.
      const direct = await getCachedNextly();
      const read = direct.findByID.bind(direct);
      let saved = false;
      const spy = vi
        .spyOn(direct, "findByID")
        .mockImplementation(async (args: Parameters<typeof read>[0]) => {
          const row = await read(args);
          if (args.collection === "pages" && !saved) {
            saved = true;
            // The other editor's save, made whatever the row holds.
            await t.nextly.update({
              collection: "pages",
              id,
              data: asOverwrite({
                content: page(list("list", { collection: CATS, limit: 7 })),
              }),
              overrideAccess: true,
            });
          }
          return row;
        });
      try {
        const refused = await change(cookie, at, { limit: 5 });
        expect(refused.status).toBe(409);
      } finally {
        spy.mockRestore();
      }
      expect((await storedList(t, "pages", id))?.props).toEqual({
        collection: CATS,
        limit: 7,
      });

      // Made again, the action reads the page as it now is and writes it.
      const applied = await change(cookie, at, { limit: 5 });
      expect(applied.status).toBe(200);
      expect((await storedList(t, "pages", id))?.props).toEqual({
        collection: CATS,
        limit: 5,
      });
    });

    it("refuses a list id the page does not hold", async () => {
      const t = await boot();
      const id = await homePage(t);
      const { cookie } = await holding(t, AUTHOR);

      const answered = await change(
        cookie,
        { collection: "pages", id },
        { limit: 3 },
        { dryRun: true, listId: "missing" }
      );
      expect(answered.status).toBe(422);
      expect(JSON.stringify(answered.body)).toContain(
        "There is no collection list"
      );
    });

    it("refuses a caller who may not change the page", async () => {
      const t = await boot();
      const id = await homePage(t);
      const { cookie } = await holding(t, ["read-pages"]);

      const answered = await change(
        cookie,
        { collection: "pages", id },
        { limit: 3 }
      );
      expect(answered.status).toBe(403);
      expect((await storedList(t, "pages", id))?.props).toEqual({
        collection: CATS,
      });
    });
  }
);
