/**
 * An entry's own design against a real instance: giving one through the
 * template actions route as a draft copy of the collection's published
 * template, the unique key and the entry's lock that keep one per entry when
 * two gives run at once, removing it, its deletion with its entry, and the
 * site drawing the entry with it once it is published.
 *
 * @module __tests__/entry-designs.integration.test
 */

process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { NextlyError } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { TEMPLATES_SLUG } from "../collections/templates";
import { pageBuilderContent } from "../page-content";
import { pageBuilder } from "../plugin";
import type { TemplateActionResult } from "../templates/template-actions-contract";

import { grant, holding, person, post, sessionOf } from "./transfer-harness";

/** Someone who looks after templates and own designs. */
const DESIGNER = [
  "read-templates",
  "create-templates",
  "update-templates",
  "delete-templates",
  "publish-templates",
  "read-posts",
];

/** A template document holding one heading, by id. */
function templateDocument(id: string) {
  return {
    formatVersion: 1,
    kind: "template",
    nodes: [
      {
        id,
        type: "core/heading",
        version: 1,
        props: { text: "Notes", level: 2 },
      },
    ],
  };
}

describe.each(getConfiguredTestDialects())(
  "an entry's own design (%s)",
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
            slug: "posts",
            labels: { singular: "Post", plural: "Posts" },
            status: true,
            fields: [
              text({ name: "title" }),
              text({ name: "slug", unique: true }),
            ],
          }),
        ],
        seedPublic: true,
      });
      await person(current, "owner");
      return current;
    }

    const act = (cookie: string, action: unknown, dryRun?: boolean) =>
      post(cookie, ["templates", "actions"], {
        action,
        ...(dryRun === undefined ? {} : { dryRun }),
      });

    async function entry(t: TestNextly, title: string): Promise<string> {
      const made = await t.nextly.create({
        collection: "posts",
        data: { title, slug: title.toLowerCase().replaceAll(" ", "-") },
        overrideAccess: true,
      });
      return String((made as { item: { id: unknown } }).item.id);
    }

    /** The collection's template, published, with one block to copy. */
    async function publishedTemplate(
      t: TestNextly,
      cookie: string
    ): Promise<string> {
      const made = await act(cookie, {
        kind: "create-template",
        collection: "posts",
        publish: true,
      });
      return (made.body.item as TemplateActionResult).template?.id ?? "";
    }

    async function designs(t: TestNextly): Promise<Record<string, unknown>[]> {
      const found = await t.nextly.find({
        collection: TEMPLATES_SLUG,
        where: { entryCollection: { equals: "posts" } },
        overrideAccess: true,
        status: "all",
        depth: 0,
        limit: 10,
      });
      return found.items as Record<string, unknown>[];
    }

    it("gives an entry its own design as a draft copy of the published template", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      const template = await publishedTemplate(t, cookie);
      // The template as published, then a working draft of it the copy must
      // not take: the copy is of what visitors see.
      await t.nextly.update({
        collection: TEMPLATES_SLUG,
        id: template,
        data: { content: templateDocument("published-heading") },
        overrideAccess: true,
      });
      await t.nextly.update({
        collection: TEMPLATES_SLUG,
        id: template,
        data: { content: templateDocument("draft-heading") },
        draft: true,
        overrideAccess: true,
      });
      const hello = await entry(t, "Hello world");

      const given = await act(cookie, {
        kind: "give-entry-design",
        collection: "posts",
        entry: hello,
      });
      expect(given.status).toBe(200);
      expect((given.body.item as TemplateActionResult).template).toMatchObject({
        title: "Hello world",
        collection: "posts",
        entry: hello,
        status: "draft",
      });
      const [row] = await designs(t);
      expect(row).toMatchObject({
        entry: `posts/${hello}`,
        entryCollection: "posts",
        entryId: hello,
        forkedFrom: template,
        status: "draft",
      });
      expect(row?.collection ?? null).toBeNull();
      expect(
        (row?.content as { nodes?: { id: string }[] }).nodes?.map(n => n.id)
      ).toEqual(["published-heading"]);

      // Still one template for the collection: the own design is not one.
      const second = await act(cookie, {
        kind: "create-template",
        collection: "posts",
      });
      expect(second.status).toBe(409);
      expect(JSON.stringify(second.body)).toContain(template);
    });

    it("refuses an entry's own design while its collection has no published template, and a second one", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      const hello = await entry(t, "Hello world");
      const action = {
        kind: "give-entry-design",
        collection: "posts",
        entry: hello,
      };

      const early = await act(cookie, action, true);
      expect((early.body.item as TemplateActionResult).refusals).toEqual([
        'The collection "posts" has no published template to copy. Publish its template first.',
      ]);
      expect(await designs(t)).toEqual([]);

      await publishedTemplate(t, cookie);
      expect((await act(cookie, action)).status).toBe(200);
      const again = await act(cookie, action);
      expect(again.status).toBe(409);
      expect(await designs(t)).toHaveLength(1);
    });

    it("keeps one own design per entry when two gives run at once", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      await publishedTemplate(t, cookie);
      const hello = await entry(t, "Hello world");
      const action = {
        kind: "give-entry-design",
        collection: "posts",
        entry: hello,
      };

      // Both found no design before writing; the entry's lock makes them
      // take turns, and the second meets the first at the unique key.
      const answers = await Promise.all([
        act(cookie, action),
        act(cookie, action),
      ]);

      expect(answers.map(answer => answer.status).sort()).toEqual([200, 409]);
      expect(await designs(t)).toHaveLength(1);
    });

    it("refuses an own design that names a collection, or an entry that does not exist, on the Direct API too", async () => {
      const t = await boot();
      const hello = await entry(t, "Hello world");
      const write = (data: Record<string, unknown>) =>
        t.nextly
          .create({
            collection: TEMPLATES_SLUG,
            data: { title: "Direct", ...data },
            overrideAccess: true,
          })
          .then(
            () => undefined,
            (error: unknown) => error
          );

      const named = await write({
        collection: "posts",
        entry: `posts/${hello}`,
        entryCollection: "posts",
        entryId: hello,
      });
      expect(NextlyError.isCode(named, "VALIDATION_ERROR")).toBe(true);
      const missing = await write({
        entry: "posts/nope",
        entryCollection: "posts",
        entryId: "nope",
      });
      expect(NextlyError.isCode(missing, "VALIDATION_ERROR")).toBe(true);
      expect(await designs(t)).toEqual([]);
    });

    it("removes an entry's own design, and refuses removing one it does not have", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      await publishedTemplate(t, cookie);
      const hello = await entry(t, "Hello world");
      const action = { collection: "posts", entry: hello };
      await act(cookie, { kind: "give-entry-design", ...action });

      const dry = await act(
        cookie,
        { kind: "remove-entry-design", ...action },
        true
      );
      expect((dry.body.item as TemplateActionResult).refusals).toEqual([]);
      expect(await designs(t)).toHaveLength(1);

      const removed = await act(cookie, {
        kind: "remove-entry-design",
        ...action,
      });
      expect(removed.status).toBe(200);
      expect(await designs(t)).toEqual([]);
      expect(
        (await act(cookie, { kind: "remove-entry-design", ...action })).status
      ).toBe(404);
    });

    it("refuses each action to a caller without its right, before reading anything", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      await publishedTemplate(t, cookie);
      const hello = await entry(t, "Hello world");
      const readerId = await person(t, "reader");
      await grant(t, readerId, ["read-templates", "read-posts"]);
      const reader = { cookie: await sessionOf(t, readerId) };

      const give = await act(reader.cookie, {
        kind: "give-entry-design",
        collection: "posts",
        entry: hello,
      });
      expect(give.status).toBe(403);
      const remove = await act(reader.cookie, {
        kind: "remove-entry-design",
        collection: "posts",
        entry: hello,
      });
      expect(remove.status).toBe(403);
    });

    it("keeps an entry's own design when its template is deleted, naming the template no longer", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      const template = await publishedTemplate(t, cookie);
      const hello = await entry(t, "Hello world");
      await act(cookie, {
        kind: "give-entry-design",
        collection: "posts",
        entry: hello,
      });
      expect((await designs(t))[0]?.forkedFrom).toBe(template);

      await t.nextly.delete({
        collection: TEMPLATES_SLUG,
        id: template,
        overrideAccess: true,
      });

      const [kept] = await designs(t);
      expect(kept?.entryId).toBe(hello);
      expect(kept?.forkedFrom ?? null).toBeNull();
    });

    it("deletes an entry's own design with the entry even after its template is gone", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      const template = await publishedTemplate(t, cookie);
      const hello = await entry(t, "Hello world");
      await act(cookie, {
        kind: "give-entry-design",
        collection: "posts",
        entry: hello,
      });
      await t.nextly.delete({
        collection: TEMPLATES_SLUG,
        id: template,
        overrideAccess: true,
      });
      expect(await designs(t)).toHaveLength(1);

      await t.nextly.delete({
        collection: "posts",
        id: hello,
        overrideAccess: true,
      });
      expect(await designs(t)).toEqual([]);
    });

    it("refuses removing the own design of an entry the caller may not read, as not found", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      await publishedTemplate(t, cookie);
      const hello = await entry(t, "Hello world");
      await act(cookie, {
        kind: "give-entry-design",
        collection: "posts",
        entry: hello,
      });
      const removerId = await person(t, "remover");
      await grant(t, removerId, ["read-templates", "delete-templates"]);
      const remover = await sessionOf(t, removerId);

      const refused = await act(remover, {
        kind: "remove-entry-design",
        collection: "posts",
        entry: hello,
      });
      expect(refused.status).toBe(404);
      expect(JSON.stringify(refused.body)).not.toContain("Hello world");
      expect(await designs(t)).toHaveLength(1);
    });

    it("draws an entry with its own design for the public once it is published, never its draft, and its neighbours with the template", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      const template = await publishedTemplate(t, cookie);
      const hello = await entry(t, "Hello world");
      const other = await entry(t, "Other");
      const content = pageBuilderContent({ nextly: t.nextly as never });
      const drawnWith = async (id: string) => {
        const found = await content.templates.readFor("posts", id, undefined);
        return {
          id: found?.id,
          nodes: (
            found?.document as { nodes?: { id: string }[] } | null
          )?.nodes?.map(node => node.id),
        };
      };
      expect((await drawnWith(hello)).id).toBe(template);

      const given = await act(cookie, {
        kind: "give-entry-design",
        collection: "posts",
        entry: hello,
      });
      const own = (given.body.item as TemplateActionResult).template?.id ?? "";
      await t.nextly.update({
        collection: TEMPLATES_SLUG,
        id: own,
        data: { content: templateDocument("own-heading") },
        overrideAccess: true,
      });
      // A draft own design is not the public's: the template still draws it.
      expect((await drawnWith(hello)).id).toBe(template);

      const published = await act(cookie, {
        kind: "publish-template",
        id: own,
      });
      expect(published.status).toBe(200);
      expect(await drawnWith(hello)).toEqual({
        id: own,
        nodes: ["own-heading"],
      });
      expect((await drawnWith(other)).id).toBe(template);

      // A working draft over the published own design stays unseen.
      await t.nextly.update({
        collection: TEMPLATES_SLUG,
        id: own,
        data: { content: templateDocument("draft-heading") },
        draft: true,
        overrideAccess: true,
      });
      expect(await drawnWith(hello)).toEqual({
        id: own,
        nodes: ["own-heading"],
      });

      // Removed, the entry is drawn with the template again.
      await act(cookie, {
        kind: "remove-entry-design",
        collection: "posts",
        entry: hello,
      });
      expect((await drawnWith(hello)).id).toBe(template);
    });

    it("deletes an entry's own design with the entry", async () => {
      const t = await boot();
      const { cookie } = await holding(t, DESIGNER);
      await publishedTemplate(t, cookie);
      const hello = await entry(t, "Hello world");
      const kept = await entry(t, "Kept");
      await act(cookie, {
        kind: "give-entry-design",
        collection: "posts",
        entry: hello,
      });
      await act(cookie, {
        kind: "give-entry-design",
        collection: "posts",
        entry: kept,
      });

      await t.nextly.delete({
        collection: "posts",
        id: hello,
        overrideAccess: true,
      });

      expect((await designs(t)).map(row => row.entryId)).toEqual([kept]);
    });
  }
);
