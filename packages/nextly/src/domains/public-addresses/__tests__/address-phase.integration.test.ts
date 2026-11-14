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

import { heldPage } from "../held-listing";
import { publicAddressOf } from "../public-address";

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
  localized = false,
  fallback = true
): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    ...(localized
      ? {
          localization: {
            locales: ["en", "fr"],
            defaultLocale: "en",
            fallback,
          },
        }
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
      // Most features at /features/{slug}; one at an address of its own.
      defineCollection({
        slug: "features",
        status: true,
        fields: [
          text({ name: "title" }),
          text({ name: "slug" }),
          text({ name: "address" }),
        ],
        publicAddress: "/features/{slug}",
        publicAddressField: "address",
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
      ...(localized
        ? [
            defineSingle({
              slug: "contact",
              localized: true,
              status: true,
              fields: [text({ name: "headline" })],
              publicAddress: "/contact",
            }),
          ]
        : []),
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
          "/hello (en) is already the address of another page. Choose another address for this entry.",
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

    it("listing a Single never saved neither creates it nor lists it", async () => {
      const t = await boot(dialect);

      const { items } = await heldPage({
        type: { kind: "single", slug: "about" },
      });

      expect(items).toEqual([]);
      expect(
        await t.nextly.findSingle({
          slug: "about",
          createIfMissing: false,
        } as never)
      ).toBeNull();
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
    it("holds no address in a language whose slug is untranslated, without fallback", async () => {
      const t = await boot(dialect, true, false);
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
        { slug: "", status: "published" },
        { locale: "fr" }
      );

      // An English save: French still has no slug of its own to be served at.
      await update(
        t,
        "articles",
        article,
        { title: "Hello again" },
        {
          locale: "en",
        }
      );

      expect(record.held()).toEqual({
        "en|/articles/hello": `articles:${article}`,
      });
    });

    it("keeps a translated Single's published language while another is saved as a draft", async () => {
      const t = await boot(dialect, true);
      const record = join(memoryParticipant());
      await t.nextly.updateSingle({
        slug: "contact",
        locale: "en",
        data: {
          headline: "Write to us",
          status: "published",
          _overwrite: true,
        },
      } as never);

      await t.nextly.updateSingle({
        slug: "contact",
        locale: "fr",
        data: { headline: "Écrivez-nous", status: "draft", _overwrite: true },
      } as never);

      expect(
        Object.keys(record.held()).filter(k => k.endsWith("/contact"))
      ).toEqual(["en|/contact"]);
    });

    it("lists a translated Single in only its published languages", async () => {
      const t = await boot(dialect, true);
      await t.nextly.updateSingle({
        slug: "contact",
        locale: "en",
        data: {
          headline: "Write to us",
          status: "published",
          _overwrite: true,
        },
      } as never);
      await t.nextly.updateSingle({
        slug: "contact",
        locale: "fr",
        data: { headline: "Écrivez-nous", status: "draft", _overwrite: true },
      } as never);

      const { items } = await heldPage({
        type: { kind: "single", slug: "contact" },
      });

      expect(items.map(item => item.holds)).toEqual([
        [{ locale: "en", path: "/contact" }],
      ]);
    });

    it("falls back past a draft translation to a published one", async () => {
      current = await createTestNextly({
        dialect,
        localization: {
          locales: ["en", { code: "fr", fallbackLocale: ["de"] }, "de"],
          defaultLocale: "en",
        },
        collections: [
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
        ],
      });
      const t = current;
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
        { slug: "hallo", status: "draft" },
        { locale: "de" }
      );

      await update(
        t,
        "articles",
        article,
        { slug: "", status: "published" },
        { locale: "fr" }
      );

      expect(record.held()).toEqual({
        "en|/articles/hello": `articles:${article}`,
        "fr|/articles/hello": `articles:${article}`,
      });
    });

    it("lists an entry the way a save records it, not through fallback", async () => {
      const t = await boot(dialect, true);
      const record = join(memoryParticipant());
      const article = await create(
        t,
        "articles",
        { title: "Hello", slug: "hello", status: "published" },
        "en"
      );

      const { items } = await heldPage({
        type: { kind: "collection", slug: "articles" },
      });

      // French was never published: a read in French may fall back to the
      // English slug, but the entry holds nothing there.
      expect(items.map(item => item.holds)).toEqual([
        [{ locale: "en", path: "/articles/hello" }],
      ]);
      expect(record.held()).toEqual({
        "en|/articles/hello": `articles:${article}`,
      });
    });

    it("lists an entry in only the languages a save says it holds", async () => {
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

      const { items } = await heldPage({
        type: { kind: "collection", slug: "articles" },
      });

      expect(items.map(item => item.holds)).toEqual([
        [{ locale: "en", path: "/articles/hello" }],
      ]);
      expect(record.held()).toEqual({
        "en|/articles/hello": `articles:${article}`,
      });
    });

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

describe.each(getConfiguredTestDialects())(
  "an entry's own address, named by a field (%s)",
  dialect => {
    it("holds an entry's own address where its field names one, else the template's", async () => {
      const t = await boot(dialect);
      const record = join(memoryParticipant());
      const own = await create(t, "features", {
        title: "Brand voice",
        slug: "brand-voice",
        address: "/brand-voice",
        status: "published",
      });
      const plain = await create(t, "features", {
        title: "Article writer",
        slug: "article-writer",
        address: "",
        status: "published",
      });

      expect(record.held()).toEqual({
        "en|/brand-voice": `features:${own}`,
        "en|/features/article-writer": `features:${plain}`,
      });
      const type = { kind: "collection" as const, slug: "features" };
      expect(
        await publicAddressOf(type, {
          slug: "brand-voice",
          address: "/brand-voice",
        })
      ).toEqual({ status: "resolved", path: "/brand-voice" });
      expect(
        await publicAddressOf(type, { slug: "article-writer", address: "" })
      ).toEqual({ status: "resolved", path: "/features/article-writer" });
    });

    it("refuses an own address another page holds, as any clash", async () => {
      const t = await boot(dialect);
      join(memoryParticipant());
      await create(t, "pages", {
        title: "Brand voice",
        slug: "brand-voice",
        status: "published",
      });

      await expect(
        create(t, "features", {
          title: "Brand voice",
          slug: "brand-voice",
          address: "/brand-voice",
          status: "published",
        })
      ).rejects.toMatchObject({
        code: "DUPLICATE",
        publicMessage:
          "/brand-voice (en) is already the address of another page. Choose another address for this entry.",
      });
    });

    it("refuses an own address no visitor could be served at, on the field", async () => {
      const t = await boot(dialect);
      await expect(
        create(t, "features", {
          title: "Elsewhere",
          slug: "elsewhere",
          address: "//other.example/brand-voice",
          status: "published",
        })
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("moves the entry's address when its own address changes, or is cleared", async () => {
      const t = await boot(dialect);
      const record = join(memoryParticipant());
      const id = await create(t, "features", {
        title: "Brand voice",
        slug: "brand-voice",
        address: "/brand-voice",
        status: "published",
      });

      await update(t, "features", id, { address: "/voice" });
      expect(record.held()).toEqual({ "en|/voice": `features:${id}` });

      await update(t, "features", id, { address: "" });
      expect(record.held()).toEqual({
        "en|/features/brand-voice": `features:${id}`,
      });
    });
  }
);
