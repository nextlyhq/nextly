/**
 * A detail read under per-language storage takes every row's translations in the same statement
 * as the row: the entry's, a populated relationship target's and a component's.
 *
 * - One depth-1 read of an entry with an author and a card sends three statements, one per table
 *   read, each joined to its translations, where reading the translations after the rows took five.
 * - It answers the values each translation holds.
 * - A component whose joined read fails is read alone and translated after, so the read still
 *   answers its translations, and the failure is logged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// A joined read of the card's instances that fails as a driver fails.
const failCardJoin = vi.hoisted(() => ({ on: false }));
vi.mock("../companion-join", async importOriginal => {
  const actual = await importOriginal<typeof import("../companion-join")>();
  const { getTableName } = await import("drizzle-orm");
  return {
    ...actual,
    selectRowsWithCompanion: (
      args: Parameters<typeof actual.selectRowsWithCompanion>[0]
    ) => {
      if (
        failCardJoin.on &&
        getTableName(args.mainTable as never) === "comp_card"
      ) {
        return Promise.reject(new Error("comp_card_locales: connection reset"));
      }
      return actual.selectRowsWithCompanion(args);
    },
  };
});

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  relationship,
  text,
  textarea,
} from "../../../config";
import { statementsOf } from "../../../database/__tests__/integration/helpers/count-statements";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  failCardJoin.on = false;
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

/** A site keeping every translatable field per language: articles with an author and a card. */
async function bootSite(dialect: TestDialect) {
  const t = await createTestNextly({
    dialect,
    perLanguageStorage: true,
    fieldGroups: [
      defineFieldGroup({
        slug: "card",
        fields: [text({ name: "heading" }), textarea({ name: "blurb" })],
      }),
    ],
    collections: [
      defineCollection({
        slug: "authors",
        fields: [text({ name: "name" }), textarea({ name: "bio" })],
      }),
      defineCollection({
        slug: "articles",
        fields: [
          text({ name: "headline" }),
          relationship({ name: "author", relationTo: "authors" }),
          fieldGroup({ name: "card", component: "card" }),
        ],
      }),
    ],
  });
  current = t;
  const author = (await t.nextly.create({
    collection: "authors",
    data: { name: "Ada", bio: "Writes about engines" },
  })) as { id?: string; item?: { id: string } };
  const authorId = author.item?.id ?? author.id ?? "";
  const article = (await t.nextly.create({
    collection: "articles",
    data: {
      headline: "On engines",
      author: authorId,
      card: { heading: "Engines", blurb: "A short history" },
    },
  })) as { id?: string; item?: { id: string } };
  return { t, articleId: article.item?.id ?? article.id ?? "" };
}

describe.each(getConfiguredTestDialects())(
  "related translations read with their rows (integration, %s)",
  dialect => {
    it("sends one statement per table a depth-1 detail read reads, each with its translations", async () => {
      const { t, articleId } = await bootSite(dialect);
      const read = () =>
        t.nextly.findByID({ collection: "articles", id: articleId, depth: 1 });
      await read();

      const statements = (await statementsOf(dialect, read)).filter(sql =>
        /dc_articles|dc_authors|comp_card/i.test(sql)
      );
      expect(statements).toHaveLength(3);
      for (const sql of statements) expect(sql).toMatch(/left join/i);
    });

    // A list page reads its translations table once: the version counters come with the content
    // when the language chain holds every language the version names, as a detail read's do.
    it("reads a list page's translations once, its version counters with its content", async () => {
      const { t, articleId } = await bootSite(dialect);
      const list = () =>
        t.nextly.find({ collection: "articles", limit: 20, depth: 0 });
      await list();

      const translationReads = (await statementsOf(dialect, list)).filter(sql =>
        /dc_articles_locales/i.test(sql)
      );
      expect(translationReads).toHaveLength(1);
      const listed = (await list()) as {
        items: { id: string; _rev?: string }[];
      };
      const detail = (await t.nextly.findByID({
        collection: "articles",
        id: articleId,
      })) as { _rev?: string };
      // A version is there to compare: two reads answering none would agree as well.
      expect(detail._rev).toMatch(/\S/);
      expect(listed.items.find(item => item.id === articleId)?._rev).toBe(
        detail._rev
      );
    });

    it("answers the values each translation holds", async () => {
      const { t, articleId } = await bootSite(dialect);
      const article = (await t.nextly.findByID({
        collection: "articles",
        id: articleId,
        depth: 1,
      })) as Record<string, unknown>;

      expect(article.headline).toBe("On engines");
      expect(article.author).toMatchObject({
        name: "Ada",
        bio: "Writes about engines",
      });
      expect(article.card).toMatchObject({
        heading: "Engines",
        blurb: "A short history",
      });
    });

    it("reads a component alone and translates it after when its joined read fails", async () => {
      const { t, articleId } = await bootSite(dialect);
      const error = vi.spyOn(
        t.getService("logger") as { error: (...args: unknown[]) => void },
        "error"
      );
      failCardJoin.on = true;

      const article = (await t.nextly.findByID({
        collection: "articles",
        id: articleId,
        depth: 1,
      })) as Record<string, unknown>;

      expect(article.card).toMatchObject({
        heading: "Engines",
        blurb: "A short history",
      });
      expect(
        error.mock.calls.some(([message]) =>
          String(message).includes("reading them alone")
        )
      ).toBe(true);
    });
  }
);
