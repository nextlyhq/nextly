/**
 * The entry designs read against a real instance: a collection's own designs
 * and its template, read as the caller, so a caller without the right to
 * read templates, or the collection, is answered nothing; and only the asked
 * collection's own designs, whether it is named or reached through its
 * template; an own design listed only where the caller may read its entry,
 * on a collection whose read rule filters rows; and one entry's own design
 * asked by its key. Then `delete-template`, which the template's delete
 * dialog runs, refused for an own design whose entry the caller may not read.
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
  "read-guides",
  "update-guides",
];

/**
 * Guides: everyone who may read them reads the open ones, and only someone
 * who may update guides reads the closed ones too. A read rule that filters
 * rows, so a caller may read the collection and still not every entry.
 */
const guides = defineCollection({
  slug: "guides",
  labels: { singular: "Guide", plural: "Guides" },
  status: true,
  access: {
    read: ({ permissions }: { permissions: string[] }) =>
      permissions.includes("update-guides")
        ? true
        : ({ team: { equals: "open" } } as unknown as boolean),
  },
  fields: [
    text({ name: "title" }),
    text({ name: "slug", unique: true }),
    text({ name: "team" }),
  ],
} as never);

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
          guides,
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
        templateReadable: true,
        // Posts has its template, so another is not offered; an own design
        // is, from the published one.
        mayCreateTemplate: false,
        mayGiveDesign: true,
        entry: null,
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

    /** Guides with a published template, and an own design for an open and a closed one. */
    async function guidesSite(t: TestNextly, cookie: string) {
      const made = await act(cookie, {
        kind: "create-template",
        collection: "guides",
        publish: true,
      });
      expect(made.status).toBe(200);
      const ids: Record<string, string> = {};
      for (const team of ["open", "closed"]) {
        const created = await t.nextly.create({
          collection: "guides",
          data: { title: `A ${team} guide`, slug: `${team}-guide`, team },
          overrideAccess: true,
        });
        const id = String((created as { item: { id: unknown } }).item.id);
        ids[team] = id;
        const given = await act(cookie, {
          kind: "give-entry-design",
          collection: "guides",
          entry: id,
        });
        expect(given.status).toBe(200);
      }
      const designs = await read(cookie, "?collection=guides");
      const designOf = (entry: string | undefined) =>
        designs.items.find(item => item.entryId === entry)?.id ?? "";
      return {
        open: ids.open ?? "",
        closed: ids.closed ?? "",
        openDesign: designOf(ids.open),
        closedDesign: designOf(ids.closed),
      };
    }

    it("lists an own design only where the caller may read its entry", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      const { open, closed } = await guidesSite(t, cookie);
      const reader = await holding(t, ["read-guides", "read-templates"]);

      // CONTROL: someone who reads every guide is listed both.
      expect(
        (await read(cookie, "?collection=guides")).items
          .map(item => item.entryId)
          .sort()
      ).toEqual([open, closed].sort());
      // A reader the rule limits to open guides is told nothing of the closed
      // one: not its id, not its title, in the list or asked by its key.
      const listed = await read(reader.cookie, "?collection=guides");
      expect(listed.items.map(item => item.entryId)).toEqual([open]);
      expect(JSON.stringify(listed)).not.toContain("A closed guide");
      const asked = await read(
        reader.cookie,
        `?collection=guides&entry=${encodeURIComponent(closed)}`
      );
      expect(asked.items).toEqual([]);
      expect(asked.meta.entry).toBe(closed);
    });

    it("answers one entry's own design by its key", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      const { hello } = await site(t, cookie);
      const plain = await entry(t, "posts", "Another post");

      const one = await read(
        cookie,
        `?collection=posts&entry=${encodeURIComponent(hello)}`
      );
      expect(one.items.map(item => item.entryId)).toEqual([hello]);
      expect(one.meta.entry).toBe(hello);
      const none = await read(
        cookie,
        `?collection=posts&entry=${encodeURIComponent(plain)}`
      );
      expect(none.items).toEqual([]);
      // An entry is asked only with its collection.
      const alone = await call("GET", cookie, ["templates", "entry-designs"], {
        query: `?entry=${encodeURIComponent(hello)}`,
      });
      expect(alone.status).toBe(400);
    });

    it("says the templates were withheld from a caller who may not read them", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      await site(t, cookie);
      const reader = await holding(t, ["read-posts"]);
      const answered = await read(reader.cookie, "?collection=posts");
      expect(answered.meta.templateReadable).toBe(false);
      expect(
        (await read(cookie, "?collection=posts")).meta.templateReadable
      ).toBe(true);
    });

    it("refuses deleting an own design whose entry the caller may not read, dry run included", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      const { openDesign, closedDesign } = await guidesSite(t, cookie);
      const remover = await holding(t, [
        "read-guides",
        "read-templates",
        "delete-templates",
      ]);

      for (const dryRun of [true, false]) {
        const refused = await post(remover.cookie, ["templates", "actions"], {
          action: { kind: "delete-template", id: closedDesign },
          dryRun,
        });
        expect(refused.status).toBe(404);
        expect(JSON.stringify(refused.body)).not.toContain("closed");
      }
      expect(
        (await read(cookie, "?collection=guides")).items.map(item => item.id)
      ).toContain(closedDesign);

      // CONTROL: the open guide's own design, whose entry the remover reads,
      // is deleted.
      const deleted = await act(remover.cookie, {
        kind: "delete-template",
        id: openDesign,
      });
      expect(deleted.status).toBe(200);
      expect(
        (await read(cookie, "?collection=guides")).items.map(item => item.id)
      ).toEqual([closedDesign]);
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
