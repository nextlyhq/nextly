/**
 * Core asks every participant, inside each save, whether the addresses the
 * saved document now holds are held by another page, refuses the save where
 * one is, and otherwise tells every participant what the document holds.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../../collections/config/define-collection";
import { text } from "../../../collections/fields/helpers";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { defineSingle } from "../../../singles/config/define-single";
import {
  addParticipant,
  removeParticipant,
  type ParticipantRunner,
} from "../participants";

import { memoryParticipant, type Holding } from "./memory-participant";

let current: TestNextly | undefined;
const joined: ParticipantRunner[] = [];

afterEach(async () => {
  for (const runner of joined.splice(0)) removeParticipant(runner);
  await current?.destroy();
  current = undefined;
});

function join<T extends { runner: ParticipantRunner }>(participant: T): T {
  addParticipant(participant.runner, "plugin:test");
  joined.push(participant.runner);
  return participant;
}

async function boot(
  dialect: TestDialect,
  localized = false
): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    ...(localized
      ? { localization: { locales: ["en", "fr"], defaultLocale: "en" } }
      : {}),
    collections: [
      defineCollection({
        slug: "pages",
        status: true,
        // Edits to a published page can be held as a working draft.
        versions: { drafts: true },
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
      defineCollection({
        slug: "posts",
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      }),
      defineCollection({
        slug: "links",
        fields: [text({ name: "title" }), text({ name: "handle" })],
        publicAddress: "/go/{handle}",
      }),
      defineCollection({
        slug: "notes",
        fields: [text({ name: "title" }), text({ name: "slug" })],
      }),
      ...(localized
        ? [
            defineCollection({
              slug: "articles",
              localized: true,
              status: true,
              fields: [
                text({ name: "title", localized: false }),
                text({ name: "slug" }),
              ],
              publicAddress: "/articles/{slug}",
            }),
          ]
        : []),
    ],
    singles: [
      defineSingle({
        slug: "about",
        fields: [text({ name: "headline" })],
        publicAddress: "/about",
      }),
    ],
  });
  return current;
}

async function create(
  t: TestNextly,
  collection: string,
  data: Record<string, unknown>,
  locale?: string
): Promise<string> {
  const created = await t.nextly.create({
    collection,
    data,
    ...(locale ? { locale } : {}),
  });
  return String(created.item.id);
}

async function update(
  t: TestNextly,
  collection: string,
  id: string,
  data: Record<string, unknown>,
  extra: Record<string, unknown> = {}
) {
  return t.nextly.update({
    collection,
    id,
    data: { ...data, _overwrite: true },
    ...extra,
  });
}

describe.each(getConfiguredTestDialects())(
  "a save asks every participant about its addresses (%s)",
  dialect => {
    it("refuses publishing a post at an address a page holds", async () => {
      const t = await boot(dialect);
      join(memoryParticipant());
      await create(t, "pages", {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      const post = await create(t, "posts", {
        title: "Hi",
        slug: "hello",
        status: "draft",
      });

      await expect(
        update(t, "posts", post, { status: "published" })
      ).rejects.toMatchObject({
        code: "DUPLICATE",
        publicMessage:
          '/hello (en) is already the address of "Hello" in pages. Choose another address for this entry.',
      });
      const stored = await t.nextly.findByID({ collection: "posts", id: post });
      expect((stored as Record<string, unknown>).status).toBe("draft");
    });

    it("records a published entry's address with every participant", async () => {
      const t = await boot(dialect);
      const one = join(memoryParticipant());
      const two = join(memoryParticipant());

      const page = await create(t, "pages", {
        title: "Hello",
        slug: "hello",
        status: "published",
      });

      expect(one.held()).toEqual({ "en|/hello": `pages:${page}` });
      expect(two.held()).toEqual({ "en|/hello": `pages:${page}` });
    });

    it("saving a holder again is allowed", async () => {
      const t = await boot(dialect);
      const record = join(memoryParticipant());
      const page = await create(t, "pages", {
        title: "Hello",
        slug: "hello",
        status: "published",
      });

      await update(t, "pages", page, { title: "Hello again" });

      expect(record.held()).toEqual({ "en|/hello": `pages:${page}` });
    });

    it("unpublishing and deleting let the address go", async () => {
      const t = await boot(dialect);
      const record = join(memoryParticipant());
      const page = await create(t, "pages", {
        title: "Hello",
        slug: "hello",
        status: "published",
      });
      const other = await create(t, "pages", {
        title: "Other",
        slug: "other",
        status: "published",
      });

      expect(Object.keys(record.held()).sort()).toEqual([
        "en|/hello",
        "en|/other",
      ]);

      await update(t, "pages", page, { status: "draft" });
      await t.nextly.delete({ collection: "pages", id: other });

      expect(record.held()).toEqual({});
    });

    it("an emptied address field holds nothing and is not refused", async () => {
      const t = await boot(dialect);
      const record = join(memoryParticipant());
      const link = await create(t, "links", { title: "A", handle: "a" });
      expect(record.held()).toEqual({ "en|/go/a": `links:${link}` });

      await update(t, "links", link, { handle: "" });

      expect(record.held()).toEqual({});
    });

    it("a Single holds its declared address", async () => {
      const t = await boot(dialect);
      const record = join(memoryParticipant());

      await t.nextly.updateSingle({
        slug: "about",
        data: { headline: "Who we are", _overwrite: true },
      });

      expect(Object.keys(record.held())).toEqual(["en|/about"]);
    });

    it("a working draft of a published entry keeps its address", async () => {
      const t = await boot(dialect);
      const record = join(memoryParticipant());
      const page = await create(t, "pages", {
        title: "Hello",
        slug: "hello",
        status: "published",
      });

      await update(t, "pages", page, { slug: "renamed" }, { draft: true });

      expect(record.held()).toEqual({ "en|/hello": `pages:${page}` });
    });

    it("a range held by a participant refuses an address inside it", async () => {
      const t = await boot(dialect);
      const seed: Holding[] = [
        {
          address: { locale: "en", path: "/go", range: true },
          holder: { collection: "lists", id: "1", label: "All links" },
        },
      ];
      join(memoryParticipant(seed));

      await expect(
        create(t, "links", { title: "A", handle: "a" })
      ).rejects.toMatchObject({ code: "DUPLICATE" });
    });

    it("a throwing participant refuses the save", async () => {
      const t = await boot(dialect);
      join({
        runner: {
          holderOf: () => Promise.reject(new Error("record unreachable")),
          record: () => Promise.resolve(),
        } satisfies ParticipantRunner,
      });

      await expect(
        create(t, "pages", {
          title: "Hello",
          slug: "hello",
          status: "published",
        })
      ).rejects.toThrow();
      const { items } = await t.nextly.find({ collection: "pages" });
      expect(items).toHaveLength(0);
    });

    it("a write to a type with no address never asks", async () => {
      const t = await boot(dialect);
      const record = join(memoryParticipant());

      await create(t, "notes", { title: "Hi", slug: "hi" });
      expect(record.calls).toEqual({ holderOf: 0, record: 0 });

      // A type with an address is asked about, so the silence above is the
      // skip, not a phase that never runs.
      await create(t, "pages", {
        title: "Hi",
        slug: "hi",
        status: "published",
      });
      expect(record.calls.holderOf).toBeGreaterThan(0);
    });

    it("with no participant, no handler runs on a save", async () => {
      const t = await boot(dialect);

      expect(t.hooks.hasInTransaction("pages")).toBe(false);

      const record = join(memoryParticipant());
      expect(t.hooks.hasInTransaction("pages")).toBe(true);
      removeParticipant(record.runner);
      expect(t.hooks.hasInTransaction("pages")).toBe(false);
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "a translated entry's addresses (%s)",
  dialect => {
    it("keeps a published language's address while another language is saved as a draft", async () => {
      const t = await boot(dialect, true);
      const record = join(memoryParticipant());
      const article = await create(
        t,
        "articles",
        { title: "Hello", slug: "hello", status: "published" },
        "en"
      );

      await update(
        t,
        "articles",
        article,
        { slug: "bonjour", status: "draft" },
        { locale: "fr" }
      );

      expect(record.held()).toEqual({
        "en|/articles/hello": `articles:${article}`,
      });
    });

    it("holds an address only in the languages it is published in, by its own slug", async () => {
      const t = await boot(dialect, true);
      const record = join(memoryParticipant());
      const article = await create(
        t,
        "articles",
        { title: "Hello", slug: "hello", status: "published" },
        "en"
      );
      expect(record.held()).toEqual({
        "en|/articles/hello": `articles:${article}`,
      });

      await update(
        t,
        "articles",
        article,
        { slug: "bonjour", status: "published" },
        { locale: "fr" }
      );

      expect(record.held()).toEqual({
        "en|/articles/hello": `articles:${article}`,
        "fr|/articles/bonjour": `articles:${article}`,
      });
    });
  }
);
