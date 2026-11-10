/**
 * Binding and unbinding a block's prop through the API, with `bind-prop` and
 * `unbind-prop` on `POST /pages/actions`.
 *
 * What only a server shows: a binding is judged as an editor save is, so one
 * to a field the entry lacks is refused; and an unbind keeps what a VISITOR
 * sees, read as the published page reads it, never a pending draft's value
 * nor one visitors can't read. A value that varies by entry or list item is
 * kept only once the caller names whose, and an image a visitor saw by its
 * address is kept in the block's address prop.
 *
 * @module __tests__/bind-actions-api.integration.test
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
import { defineCollection, relationship, text, upload } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { TEMPLATES_SLUG } from "../collections/templates";
import type { PageActionResult } from "../composition-actions-contract";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

import { holding, person, post } from "./transfer-harness";

const ARTICLES = "ba_articles";
/** Who an article is by: a collection named by its `name`. */
const WRITERS = "ba_writers";
const AUTHOR = [
  "read-ba_articles",
  "update-ba_articles",
  `read-${TEMPLATES_SLUG}`,
  `update-${TEMPLATES_SLUG}`,
];

const heading = (id: string, binding?: Record<string, unknown>): BlockNode =>
  ({
    id,
    type: "core/heading",
    version: 1,
    props: { text: "Its own heading", level: 2 },
    ...(binding === undefined ? {} : { bindings: { text: binding } }),
  }) as BlockNode;

const page = (kind: "page" | "template", nodes: BlockNode[]) => ({
  formatVersion: 1,
  kind,
  nodes,
});

describe.each(getConfiguredTestDialects())(
  "binding and unbinding a prop through the API (%s)",
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
            status: true,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              text({ name: "secret", access: { read: () => false } }),
              upload({ name: "cover", relationTo: "media" }),
              relationship({ name: "author", relationTo: WRITERS }),
              { name: "content", type: BLOCKS_TYPE } as never,
            ],
          }),
          defineCollection({
            slug: WRITERS,
            status: true,
            access: { read: () => true },
            admin: { useAsTitle: "name" },
            fields: [text({ name: "name" })],
          }),
        ],
        seedPublic: true,
      });
      await person(current, "owner");
      return current;
    }

    /** A published article holding `nodes`. */
    async function article(
      t: TestNextly,
      title: string,
      nodes: BlockNode[] = [],
      more: Record<string, unknown> = {}
    ): Promise<string> {
      const row = await t.nextly.create({
        collection: ARTICLES,
        data: {
          title,
          secret: "The staff door code",
          status: "published",
          content: page("page", nodes),
          ...more,
        },
        overrideAccess: true,
      });
      return String(row.item.id);
    }

    /** A block of a document as its working draft stores it. */
    async function stored(
      t: TestNextly,
      collection: string,
      id: string,
      nodeId: string
    ): Promise<BlockNode | undefined> {
      const row = (await t.nextly.findByID({
        collection,
        id,
        overrideAccess: true,
        status: "all",
        draft: true,
        depth: 0,
      })) as unknown as { content: { nodes: BlockNode[] } };
      const find = (nodes: readonly BlockNode[]): BlockNode | undefined => {
        for (const node of nodes) {
          if (node.id === nodeId) return node;
          for (const slot of Object.values(node.slots ?? {})) {
            const inside = find(slot);
            if (inside !== undefined) return inside;
          }
        }
        return undefined;
      };
      return find(row.content.nodes);
    }

    const act = (
      cookie: string,
      at: { collection: string; id: string },
      action: Record<string, unknown>,
      dryRun = false
    ) =>
      post(cookie, ["pages", "actions"], {
        page: at,
        action,
        ...(dryRun ? { dryRun: true } : {}),
      });

    const unbound = (body: Record<string, unknown>) =>
      (body.item as PageActionResult).unbound;

    it("binds a prop, and refuses a field the entry lacks", async () => {
      const t = await boot();
      const id = await article(t, "Spring sale", [heading("h")]);
      const { cookie } = await holding(t, AUTHOR);
      const at = { collection: ARTICLES, id };

      const bound = await act(cookie, at, {
        kind: "bind-prop",
        nodeId: "h",
        prop: "text",
        binding: { $bind: "title" },
      });
      expect(bound.status).toBe(200);
      expect((await stored(t, ARTICLES, id, "h"))?.bindings).toEqual({
        text: { $bind: "title" },
      });

      const missing = {
        kind: "bind-prop",
        nodeId: "h",
        prop: "text",
        binding: { $bind: "headline" },
      };
      const dry = await act(cookie, at, missing, true);
      expect((dry.body.item as PageActionResult).refusals.join("\n")).toContain(
        "headline"
      );
      expect((await act(cookie, at, missing)).status).toBe(422);
    });

    it("keeps a link's related entry by its reference, naming the entry visitors were sent to", async () => {
      const t = await boot();
      const writer = await t.nextly.create({
        collection: WRITERS,
        data: { name: "Ada Lovelace", status: "published" },
        overrideAccess: true,
      });
      const writerId = String(writer.item.id);
      // A byline button linking to the article's author, by the author's id.
      const byline = {
        id: "b",
        type: "core/button",
        version: 1,
        props: { label: "About the author", entryCollection: WRITERS },
        bindings: { entryId: { $bind: "author.id" } },
      } as BlockNode;
      const id = await article(t, "Byline", [byline], { author: writerId });
      const { cookie } = await holding(t, AUTHOR);

      const answer = await act(
        cookie,
        { collection: ARTICLES, id },
        { kind: "unbind-prop", nodeId: "b", prop: "entryId" }
      );
      expect(answer.status).toBe(200);
      // The entry visitors were sent to, named by the title they may read.
      expect(unbound(answer.body)).toMatchObject({
        kept: "visitor",
        value: writerId,
        entry: { title: "Ada Lovelace" },
      });
      // Kept as the entry's reference, beside its collection: the link goes
      // on to the same page whatever its address becomes, never a copied href.
      const node = await stored(t, ARTICLES, id, "b");
      expect(node?.props).toMatchObject({
        entryCollection: WRITERS,
        entryId: writerId,
      });
      expect(node?.props).not.toHaveProperty("href");
      expect(node).not.toHaveProperty("bindings");
    });

    it("keeps the PUBLISHED value a visitor sees, not a pending draft's", async () => {
      const t = await boot();
      const id = await article(t, "Live title", [
        heading("h", { $bind: "title" }),
      ]);
      // A draft of the article changes its title; visitors still see the live one.
      await t.nextly.update({
        collection: ARTICLES,
        id,
        data: { title: "Draft title", _overwrite: true },
        overrideAccess: true,
      });
      const { cookie } = await holding(t, AUTHOR);

      const answer = await act(
        cookie,
        { collection: ARTICLES, id },
        { kind: "unbind-prop", nodeId: "h", prop: "text" }
      );
      expect(answer.status).toBe(200);
      expect(unbound(answer.body)).toMatchObject({
        kept: "visitor",
        value: "Live title",
      });
      const node = await stored(t, ARTICLES, id, "h");
      expect(node?.props.text).toBe("Live title");
      expect(node).not.toHaveProperty("bindings");
    });

    it("never copies in a field visitors can't read: the fallback is kept", async () => {
      const t = await boot();
      const id = await article(t, "Spring sale", [
        heading("h", { $bind: "secret", fallback: "Ask us at the front desk" }),
      ]);
      const { cookie } = await holding(t, AUTHOR);

      const answer = await act(
        cookie,
        { collection: ARTICLES, id },
        { kind: "unbind-prop", nodeId: "h", prop: "text" }
      );
      expect(answer.status).toBe(200);
      expect(unbound(answer.body)).toMatchObject({ kept: "fallback" });
      const node = await stored(t, ARTICLES, id, "h");
      expect(node?.props.text).toBe("Ask us at the front desk");
      expect(JSON.stringify(node)).not.toContain("staff door code");
    });

    it("keeps a list item's value only once the item is named", async () => {
      const t = await boot();
      const other = await article(t, "Autumn sale");
      const id = await article(t, "Index", [
        {
          id: "list",
          type: "core/collection-loop",
          version: 1,
          props: { collection: ARTICLES, limit: 3 },
          slots: {
            children: [heading("entry", { $bind: "title", source: "item" })],
          },
        } as BlockNode,
      ]);
      const { cookie } = await holding(t, AUTHOR);
      const at = { collection: ARTICLES, id };
      const unbind = { kind: "unbind-prop", nodeId: "entry", prop: "text" };

      const unnamed = await act(cookie, at, unbind);
      expect(unnamed.status).toBe(422);
      expect(JSON.stringify(unnamed.body)).toContain("name the item");

      const named = await act(cookie, at, { ...unbind, keep: { item: other } });
      expect(named.status).toBe(200);
      expect((await stored(t, ARTICLES, id, "entry"))?.props.text).toBe(
        "Autumn sale"
      );
    });

    it("keeps a template's value only once the entry is named", async () => {
      const t = await boot();
      const entry = await article(t, "Spring sale");
      const template = await t.nextly.create({
        collection: TEMPLATES_SLUG,
        data: {
          title: "Articles",
          collection: ARTICLES,
          status: "published",
          content: page("template", [heading("h", { $bind: "title" })]),
        },
        overrideAccess: true,
      });
      const { cookie } = await holding(t, AUTHOR);
      const at = { collection: TEMPLATES_SLUG, id: String(template.item.id) };
      const unbind = { kind: "unbind-prop", nodeId: "h", prop: "text" };

      const unnamed = await act(cookie, at, unbind);
      expect(unnamed.status).toBe(422);
      expect(JSON.stringify(unnamed.body)).toContain("name the entry");

      const named = await act(cookie, at, { ...unbind, keep: { entry } });
      expect(named.status).toBe(200);
      expect((await stored(t, TEMPLATES_SLUG, at.id, "h"))?.props.text).toBe(
        "Spring sale"
      );
    });

    it("keeps a value the caller gives", async () => {
      const t = await boot();
      const id = await article(t, "Spring sale", [
        heading("h", { $bind: "title" }),
      ]);
      const { cookie } = await holding(t, AUTHOR);
      const answer = await act(
        cookie,
        { collection: ARTICLES, id },
        {
          kind: "unbind-prop",
          nodeId: "h",
          prop: "text",
          keep: { value: "Thirty per cent off" },
        }
      );
      expect(answer.status).toBe(200);
      expect(unbound(answer.body)).toMatchObject({ kept: "value" });
      expect((await stored(t, ARTICLES, id, "h"))?.props.text).toBe(
        "Thirty per cent off"
      );
    });

    it("keeps an image a visitor saw by its address in the address prop", async () => {
      const t = await boot();
      const address = "https://cdn.example.com/spring/cover.jpg";
      // No cover chosen: visitors see the binding's fallback, an address.
      const id = await article(t, "Spring sale", [
        {
          id: "img",
          type: "core/image",
          version: 1,
          props: { alt: "Spring sale" },
          bindings: { mediaId: { $bind: "cover", fallback: address } },
        } as BlockNode,
      ]);
      const { cookie } = await holding(t, AUTHOR);

      const answer = await act(
        cookie,
        { collection: ARTICLES, id },
        { kind: "unbind-prop", nodeId: "img", prop: "mediaId" }
      );
      expect(answer.status).toBe(200);
      expect(unbound(answer.body)).toMatchObject({
        kept: "fallback",
        value: address,
        into: "src",
      });
      const node = await stored(t, ARTICLES, id, "img");
      expect(node?.props).toMatchObject({ src: address, alt: "Spring sale" });
      expect(node?.props).not.toHaveProperty("mediaId");
    });

    it("refuses to unbind a prop that is not bound", async () => {
      const t = await boot();
      const id = await article(t, "Spring sale", [heading("h")]);
      const { cookie } = await holding(t, AUTHOR);
      const refused = await act(
        cookie,
        { collection: ARTICLES, id },
        { kind: "unbind-prop", nodeId: "h", prop: "text" }
      );
      expect(refused.status).toBe(422);
      expect(JSON.stringify(refused.body)).toContain("not bound");
    });
  }
);
