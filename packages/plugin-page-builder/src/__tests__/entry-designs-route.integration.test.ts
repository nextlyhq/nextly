/**
 * The entry designs read against a real instance: a collection's own designs
 * and its template, read as the caller, so a caller without the right to
 * read templates, or the collection, is answered nothing; and only the asked
 * collection's own designs, whether it is named or reached through its
 * template. Then `delete-template`, which the template's delete dialog runs.
 *
 * @module __tests__/entry-designs-route.integration.test
 */

process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { TEMPLATES_SLUG } from "../collections/templates";
import { pageBuilder } from "../plugin";
import type { EntryDesignsResponse } from "../templates/entry-designs-contract";
import type { TemplateActionResult } from "../templates/template-actions-contract";

import { call, holding, person, post } from "./transfer-harness";

/** Someone who looks after templates and own designs, for both collections. */
const DESIGNER = [
  "read-templates",
  "create-templates",
  "update-templates",
  "delete-templates",
  "publish-templates",
  "read-posts",
  "read-articles",
];

/** A collection with an address, so it may have a template. */
function addressed(slug: string, singular: string, plural: string) {
  return defineCollection({
    slug,
    labels: { singular, plural },
    status: true,
    fields: [text({ name: "title" }), text({ name: "slug", unique: true })],
  });
}

describe.each(getConfiguredTestDialects())(
  "the entry designs read (%s)",
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
          addressed("posts", "Post", "Posts"),
          addressed("articles", "Article", "Articles"),
        ],
        seedPublic: true,
      });
      await person(current, "owner");
      return current;
    }

    const act = (cookie: string, action: unknown) =>
      post(cookie, ["templates", "actions"], { action });

    const read = async (cookie: string, query: string) => {
      const answered = await call(
        "GET",
        cookie,
        ["templates", "entry-designs"],
        {
          query,
        }
      );
      expect(answered.status).toBe(200);
      return answered.body as unknown as EntryDesignsResponse;
    };

    async function entry(
      t: TestNextly,
      collection: string,
      title: string
    ): Promise<string> {
      const made = await t.nextly.create({
        collection,
        data: { title, slug: title.toLowerCase().replaceAll(" ", "-") },
        overrideAccess: true,
      });
      return String((made as { item: { id: unknown } }).item.id);
    }

    /** Both collections with a published template, and own designs in each. */
    async function site(t: TestNextly, cookie: string) {
      const templateOf: Record<string, string> = {};
      for (const collection of ["posts", "articles"]) {
        const made = await act(cookie, {
          kind: "create-template",
          collection,
          title: collection === "posts" ? "Blog post" : "Article page",
          publish: true,
        });
        templateOf[collection] =
          (made.body.item as TemplateActionResult).template?.id ?? "";
      }
      const hello = await entry(t, "posts", "Hello world");
      const notes = await entry(t, "posts", "Field notes");
      await entry(t, "posts", "Plain post");
      const essay = await entry(t, "articles", "An essay");
      for (const [collection, id] of [
        ["posts", hello],
        ["posts", notes],
        ["articles", essay],
      ] as const) {
        const given = await act(cookie, {
          kind: "give-entry-design",
          collection,
          entry: id,
        });
        expect(given.status).toBe(200);
      }
      return { templateOf, hello, notes, essay };
    }

    it("lists only the asked collection's own designs, with its template and names", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      const { templateOf, hello, notes } = await site(t, cookie);

      const posts = await read(cookie, "?collection=posts");
      // Both of Posts' own designs and not the article's: a read that
      // ignored the collection would answer three.
      expect(posts.items.map(item => item.entryId).sort()).toEqual(
        [hello, notes].sort()
      );
      for (const item of posts.items) {
        expect(item.status).toBe("draft");
        expect(typeof item.id).toBe("string");
      }
      expect(posts.items.map(item => item.title).sort()).toEqual([
        "Field notes",
        "Hello world",
      ]);
      expect(posts.meta).toMatchObject({
        total: 2,
        hasNext: false,
        template: {
          id: templateOf.posts,
          title: "Blog post",
          status: "published",
        },
        templateAllowed: true,
        mayCreateTemplate: true,
        templatesCollection: TEMPLATES_SLUG,
        names: { singular: "Post", plural: "Posts" },
        collection: "posts",
      });

      // Reached through its template, the same answer.
      const viaTemplate = await read(
        cookie,
        `?template=${encodeURIComponent(templateOf.posts ?? "")}`
      );
      expect(viaTemplate.items.map(item => item.entryId).sort()).toEqual(
        [hello, notes].sort()
      );
      expect(viaTemplate.meta.template?.id).toBe(templateOf.posts);
    });

    it("answers nothing to a caller who may not read templates", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      await site(t, cookie);
      const reader = await holding(t, ["read-posts"]);

      const answered = await read(reader.cookie, "?collection=posts");
      expect(answered.items).toEqual([]);
      expect(answered.meta.template).toBeNull();
      expect(answered.meta.mayCreateTemplate).toBe(false);
      // CONTROL: the same read as the designer lists them, so the empty
      // answer above is the caller's rights, not an empty site.
      expect((await read(cookie, "?collection=posts")).items).toHaveLength(2);
    });

    it("answers nothing about a collection the caller may not read", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      await site(t, cookie);
      const templatesOnly = await holding(t, ["read-templates"]);

      const answered = await read(templatesOnly.cookie, "?collection=posts");
      expect(answered.items).toEqual([]);
      expect(answered.meta.template).toBeNull();
      expect(answered.meta.names).toEqual({
        singular: "posts",
        plural: "posts",
      });
    });

    it("refuses a read naming both a collection and a template, or neither", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      const both = await call("GET", cookie, ["templates", "entry-designs"], {
        query: "?collection=posts&template=t1",
      });
      expect(both.status).toBe(400);
      const neither = await call("GET", cookie, ["templates", "entry-designs"]);
      expect(neither.status).toBe(400);
    });

    it("deletes a collection's template and keeps its own designs, after a dry run that writes nothing", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      const { templateOf } = await site(t, cookie);
      const action = { kind: "delete-template", id: templateOf.posts };

      const dry = await post(cookie, ["templates", "actions"], {
        action,
        dryRun: true,
      });
      expect(dry.status).toBe(200);
      expect(dry.body.item).toMatchObject({
        dryRun: true,
        kind: "delete-template",
        refusals: [],
        template: { id: templateOf.posts, collection: "posts" },
      });
      expect((await read(cookie, "?collection=posts")).meta.template?.id).toBe(
        templateOf.posts
      );

      const deleted = await act(cookie, action);
      expect(deleted.status).toBe(200);
      const after = await read(cookie, "?collection=posts");
      expect(after.meta.template).toBeNull();
      expect(after.items).toHaveLength(2);
    });

    it("refuses deleting a template to a caller without the right", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      const { templateOf } = await site(t, cookie);
      const reader = await holding(t, ["read-templates", "read-posts"]);

      const refused = await act(reader.cookie, {
        kind: "delete-template",
        id: templateOf.posts,
      });
      expect(refused.status).toBe(403);
      expect((await read(cookie, "?collection=posts")).meta.template?.id).toBe(
        templateOf.posts
      );
    });
  }
);
