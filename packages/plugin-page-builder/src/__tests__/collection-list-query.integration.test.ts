/**
 * A collection list's query, read on a published page the same way on every
 * database: each filter operator, the sort with empty values last and ties
 * in id order, a calendar day compared as a day, a relation's entries in
 * their stored order as the public reads the relation, and a stored sort the
 * public may not use.
 *
 * Driven through the real block (`core/collection-loop`), the default data
 * provider and the public reader over a real instance, so what is checked
 * is what a visitor's page reads, not a stand-in for it.
 *
 * Two answers differ by database and are recorded rather than held equal:
 * how mixed-case text orders (each database's collation, a known limit),
 * and whether `contains` folds the case of letters outside ASCII.
 *
 * @module __tests__/collection-list-query.integration.test
 */
import { collectionLoop } from "@nextlyhq/blocks-react/blocks";
import {
  createDefaultDataProvider,
  type PageContext,
} from "@nextlyhq/blocks-react";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import {
  checkbox,
  date,
  defineCollection,
  number,
  relationship,
  select,
  text,
} from "nextly/config";
import { bindingFieldShapes, createPublicReader } from "nextly/runtime";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { asOverwrite } from "../document-version";

const POSTS = "lqi_posts";
const CATS = "lqi_cats";
const WORDS = "lqi_words";
const DOCS = "lqi_docs";
const SHELVES = "lqi_shelves";
const TAGS = "lqi_tags";
const BOARDS = "lqi_boards";

type Row = Record<string, unknown>;

/** What one list drew: its entries' titles in order, and any note. */
interface Drawn {
  readonly titles: string[];
  readonly note: string | null;
}

describe.each(getConfiguredTestDialects())(
  "a collection list's query on a published page (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        seedPublic: true,
        localization: { locales: ["en", "fr"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: CATS,
            status: true,
            access: { read: () => true },
            fields: [text({ name: "title" })],
          }),
          defineCollection({
            slug: POSTS,
            status: true,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              number({ name: "rank" }),
              select({
                name: "kind",
                options: [
                  { label: "News", value: "news" },
                  { label: "Guide", value: "guide" },
                  { label: "Recipe", value: "recipe" },
                ],
              }),
              checkbox({ name: "featured" }),
              text({ name: "note" }),
              date({
                name: "publishedAt",
                admin: { date: { pickerAppearance: "dayAndTime" } },
              }),
              date({ name: "eventDay" }),
              relationship({
                name: "categories",
                relationTo: CATS,
                hasMany: true,
              }),
              text({ name: "secret", access: { read: () => false } }),
            ],
          }),
          defineCollection({
            slug: WORDS,
            status: true,
            access: { read: () => true },
            fields: [text({ name: "word" })],
          }),
          defineCollection({
            slug: SHELVES,
            status: true,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              relationship({
                name: "categories",
                relationTo: CATS,
                hasMany: true,
              }),
              // The same relation, with a read rule that denies the public.
              relationship({
                name: "staffPicks",
                relationTo: CATS,
                hasMany: true,
                access: { read: () => false },
              }),
            ],
          }),
          defineCollection({
            slug: TAGS,
            status: true,
            access: { read: () => true },
            fields: [text({ name: "title" }), number({ name: "rank" })],
          }),
          defineCollection({
            slug: BOARDS,
            status: true,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              relationship({ name: "tags", relationTo: TAGS, hasMany: true }),
            ],
          }),
          defineCollection({
            slug: DOCS,
            localized: true,
            status: true,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              text({ name: "heading", localized: true }),
            ],
          }),
        ],
      });
      const make = async (collection: string, data: Row) => {
        const row = await t.nextly.create({
          collection,
          data: { ...data, status: "published" },
          overrideAccess: true,
        });
        return String(row.item.id);
      };
      for (const name of ["Alpha", "Beta", "Gamma"]) {
        ids[name] = await make(CATS, { title: name });
      }
      const posts: Row[] = [
        {
          title: "Café crème",
          rank: 1,
          kind: "news",
          featured: true,
          note: "b",
          categories: [ids.Alpha, ids.Beta],
        },
        {
          title: "Crème brûlée",
          rank: 2,
          kind: "recipe",
          featured: false,
          note: "a",
          categories: [ids.Gamma],
        },
        {
          title: "Plain toast",
          rank: 2,
          kind: "guide",
          featured: false,
          note: "",
          categories: [],
        },
        {
          title: "Ñandú facts",
          rank: 3,
          kind: "news",
          featured: true,
          note: null,
          categories: [ids.Beta],
        },
        {
          title: "Zebra notes",
          rank: 2,
          kind: "guide",
          featured: false,
          categories: [ids.Alpha],
        },
      ];
      for (const post of posts) {
        ids[String(post.title)] = await make(POSTS, {
          ...post,
          secret: `s-${String(post.title)}`,
        });
      }
      // Times around 1 September in Karachi (UTC+5): 01:00 and 23:59 on the
      // 1st, and midnight starting the 2nd.
      const instants: [string, string][] = [
        ["Café crème", "2026-08-31T20:00:00.000Z"],
        ["Crème brûlée", "2026-09-01T18:59:59.000Z"],
        ["Plain toast", "2026-09-01T19:00:00.000Z"],
      ];
      for (const [title, at] of instants) {
        await t.nextly.update({
          collection: POSTS,
          id: ids[title] ?? "",
          // A fixture setting the seeded times whatever the row holds, so
          // it says it overwrites rather than sending a version it never read.
          data: asOverwrite({ publishedAt: at, eventDay: "2026-09-01" }),
          overrideAccess: true,
        });
      }
      for (const word of ["banana", "Apple", "cherry", "apple", "Banana"]) {
        ids[`word:${word}`] = await make(WORDS, { word });
      }
      for (const [title, heading] of [
        ["d1", "Beta"],
        ["d2", ""],
        ["d3", "Alpha"],
      ]) {
        ids[`doc:${title}`] = await make(DOCS, { title, heading });
      }
    });

    afterAll(async () => {
      await t?.destroy();
    });

    /** Draw one list over the public reader, as a published page would. */
    async function drawn(
      props: Row,
      context: Partial<PageContext> = {},
      /** The field each entry is told apart by. */
      shown = "title"
    ): Promise<Drawn> {
      const titles: string[] = [];
      const ctx: PageContext = {
        entry: null,
        data: createDefaultDataProvider(
          createPublicReader(t.nextly, { locale: "en" })
        ),
        locale: "en",
        resolveMedia: () => Promise.resolve(null),
        resolveEntryPath: () => Promise.resolve(null),
        ...context,
      };
      const element = (await collectionLoop.render({
        props,
        node: { id: "list", type: "core/collection-loop", version: 1, props },
        className: "list",
        partClass: () => "",
        ctx,
        renderSlot: (name: string, inner?: PageContext) => {
          const item = inner?.item;
          if (name === "children" && item !== undefined) {
            titles.push(String(item[shown] ?? ""));
          }
          return null;
        },
      })) as ReactElement;
      const host = renderToStaticMarkup(element);
      const note = /data-nx-list-diagnostic="[^"]+"><span>([^<]*)</.exec(host);
      // The markup escapes quotes; the note is compared as an author reads it.
      const text = note?.[1]
        ?.replaceAll("&quot;", '"')
        .replaceAll("&#x27;", "'")
        .replaceAll("&amp;", "&");
      return { titles, note: text ?? null };
    }

    const titlesOf = async (props: Row, context?: Partial<PageContext>) =>
      (await drawn({ collection: POSTS, limit: 100, ...props }, context))
        .titles;

    const filtered = (field: string, op: string, value: unknown) =>
      // By rank first: titles differing in their first letter only by a
      // letter outside ASCII order by collation, which differs by database.
      titlesOf({ filters: [{ field, op, value }], sort: "rank,title" });

    it("reads each operator with the same results", async () => {
      expect(await filtered("title", "equals", "Café crème")).toEqual([
        "Café crème",
      ]);
      expect(await filtered("kind", "not_equals", "news")).toEqual([
        "Crème brûlée",
        "Plain toast",
        "Zebra notes",
      ]);
      expect(await filtered("rank", "greater_than", 2)).toEqual([
        "Ñandú facts",
      ]);
      expect(await filtered("rank", "greater_than_equal", 3)).toEqual([
        "Ñandú facts",
      ]);
      expect(await filtered("rank", "less_than", 2)).toEqual(["Café crème"]);
      expect(await filtered("rank", "less_than_equal", 1)).toEqual([
        "Café crème",
      ]);
      expect(await filtered("kind", "in", ["guide", "recipe"])).toEqual([
        "Crème brûlée",
        "Plain toast",
        "Zebra notes",
      ]);
      expect(await filtered("kind", "not_in", ["news", "guide"])).toEqual([
        "Crème brûlée",
      ]);
      expect(await filtered("featured", "equals", true)).toEqual([
        "Café crème",
        "Ñandú facts",
      ]);
      expect(await filtered("note", "exists", false)).toEqual([
        "Zebra notes",
        "Ñandú facts",
      ]);
    });

    it("matches contains whatever the case, letters outside ASCII included when written alike", async () => {
      expect(await filtered("title", "contains", "crème")).toEqual([
        "Café crème",
        "Crème brûlée",
      ]);
      expect(await filtered("title", "contains", "CAFé CR")).toEqual([
        "Café crème",
      ]);
      expect(await filtered("title", "contains", "ÑANDú")).toEqual([
        "Ñandú facts",
      ]);
    });

    it("records whether contains folds a letter outside ASCII written in another case", async () => {
      // "CRÈME" upper-cases the È: folding it is the database's lower(), which
      // on SQLite is ASCII-only.
      const found = await filtered("title", "contains", "CRÈME");
      console.info(`[${dialect}] contains "CRÈME" -> ${JSON.stringify(found)}`);
      expect([
        JSON.stringify(["Café crème", "Crème brûlée"]),
        JSON.stringify([]),
      ]).toContain(JSON.stringify(found));
    });

    it("matches the entries holding any of the ids with in on a has-many relation, on every database", async () => {
      // The relation is stored and the public reads it...
      const { items } = await createPublicReader(t.nextly, {
        locale: "en",
      }).find({
        collection: POSTS,
        filters: [{ field: "title", op: "equals", value: "Café crème" }],
        select: ["categories"],
      });
      expect(JSON.stringify(items[0]?.categories)).toContain(String(ids.Alpha));
      // ...and `in` reads as "includes any of": an entry is kept when its list
      // holds one of the ids, whichever place in the list it has.
      const holding = async (wanted: string[]) =>
        drawn(
          {
            collection: POSTS,
            filters: [
              {
                field: "categories",
                op: "in",
                value: wanted.map(name => ids[name]),
              },
            ],
            sort: "title",
          },
          { diagnostics: true }
        );
      expect(await holding(["Alpha"])).toEqual({
        titles: ["Café crème", "Zebra notes"],
        note: null,
      });
      expect(await holding(["Gamma", "Beta"])).toEqual({
        titles: ["Café crème", "Crème brûlée", "Ñandú facts"],
        note: null,
      });
    });

    it("sorts empty values last in either direction, an empty string as a value", async () => {
      expect(await titlesOf({ sort: "note" })).toEqual([
        "Plain toast",
        "Crème brûlée",
        "Café crème",
        ...(await titlesOf({
          filters: [{ field: "note", op: "exists", value: false }],
        })),
      ]);
      expect(await titlesOf({ sort: "-note" })).toEqual([
        "Café crème",
        "Crème brûlée",
        "Plain toast",
        ...(await titlesOf({
          filters: [{ field: "note", op: "exists", value: false }],
        })),
      ]);
    });

    it("sorts an empty translation of a per-language field last in either direction", async () => {
      const docs = (sort: string) =>
        drawn({ collection: DOCS, sort }, {}, "heading").then(
          found => found.titles
        );
      expect(await docs("heading")).toEqual(["Alpha", "Beta", ""]);
      expect(await docs("-heading")).toEqual(["Beta", "Alpha", ""]);
    });

    it("breaks ties by id in either direction", async () => {
      // The id order as the database keeps it, read rather than recomputed.
      const tied = new Set(["Crème brûlée", "Plain toast", "Zebra notes"]);
      const expected = (await titlesOf({ sort: "id" })).filter(title =>
        tied.has(title)
      );
      const ascending = await titlesOf({
        filters: [{ field: "rank", op: "equals", value: 2 }],
        sort: "rank",
      });
      const descending = await titlesOf({
        filters: [{ field: "rank", op: "equals", value: 2 }],
        sort: "-rank",
      });
      expect(ascending).toEqual(expected);
      expect(descending).toEqual(expected);
    });

    it("records how mixed-case text orders under the database's collation", async () => {
      const words = (
        await drawn({ collection: WORDS, sort: "word", limit: 10 }, {}, "word")
      ).titles;
      console.info(
        `[${dialect}] mixed case by word -> ${JSON.stringify(words)}`
      );
      expect([...words].sort()).toEqual([
        "Apple",
        "Banana",
        "apple",
        "banana",
        "cherry",
      ]);
    });

    it("compares a date filter by whole days, in the site's zone for an instant", async () => {
      const karachi = { timeZone: "Asia/Karachi" };
      const day = (op: string) =>
        titlesOf(
          {
            filters: [{ field: "publishedAt", op, value: "2026-09-01" }],
            sort: "title",
          },
          karachi
        );
      expect(await day("greater_than")).toEqual(["Plain toast"]);
      expect(await day("greater_than_equal")).toEqual([
        "Café crème",
        "Crème brûlée",
        "Plain toast",
      ]);
      expect(await day("less_than_equal")).toEqual([
        "Café crème",
        "Crème brûlée",
      ]);
      expect(await day("less_than")).toEqual([]);
    });

    it("compares a calendar-day field as that day, whatever the site's zone", async () => {
      const shapes = await bindingFieldShapes({ collection: POSTS });
      const onTheFirst = await titlesOf(
        {
          filters: [
            {
              field: "eventDay",
              op: "greater_than_equal",
              value: "2026-09-01",
            },
            { field: "eventDay", op: "less_than_equal", value: "2026-09-01" },
          ],
          sort: "title",
        },
        {
          timeZone: "America/New_York",
          fieldShapes: { fieldsOf: () => shapes },
        }
      );
      expect(onTheFirst).toEqual(["Café crème", "Crème brûlée", "Plain toast"]);
    });

    describe("a related source", () => {
      const related = (field: string, props: Row = {}) => ({
        collection: CATS,
        relation: { of: "entry", field },
        ...props,
      });

      /**
       * A shelf holding the categories against their id order in both of its
       * relations, so the stored order is what a list shows, and the route's
       * own read of it: trusted, so it holds the relation the public may not
       * read.
       */
      async function shelf(): Promise<{ entry: Row; stored: string[] }> {
        const byId = (await drawn({ collection: CATS, sort: "id" })).titles;
        const stored = [...byId].reverse();
        const picks = stored.map(title => ids[title] ?? "");
        const created = await t.nextly.create({
          collection: SHELVES,
          data: {
            title: "Shelf",
            categories: picks,
            staffPicks: picks,
            status: "published",
          },
          overrideAccess: true,
        });
        const entry = (await t.nextly.findByID({
          collection: SHELVES,
          id: String(created.item.id),
          depth: 0,
          overrideAccess: true,
        })) as Row;
        return { entry, stored };
      }

      it("lists an entry's categories in the order it stores them, through the reader", async () => {
        const { entry, stored } = await shelf();
        const page = { entry, entryCollection: SHELVES, diagnostics: true };
        expect(await drawn(related("categories"), page)).toEqual({
          titles: stored,
          note: null,
        });
        const sorted = await drawn(
          related("categories", { sort: "title", offset: 1 }),
          page
        );
        expect(sorted.titles).toEqual(["Beta", "Gamma"]);
      });

      it("lists nothing from a relation the public may not read, though the route's entry holds it", async () => {
        const { entry } = await shelf();
        // The route's read holds the relation...
        expect(Array.isArray(entry.staffPicks)).toBe(true);
        expect((entry.staffPicks as unknown[]).length).toBe(3);
        // ...and the page draws the list's empty state from it, telling an
        // author why, while the public relation beside it still lists.
        const visitor = await drawn(related("staffPicks"), {
          entry,
          entryCollection: SHELVES,
        });
        expect(visitor).toEqual({ titles: [], note: null });
        const author = await drawn(related("staffPicks"), {
          entry,
          entryCollection: SHELVES,
          diagnostics: true,
        });
        expect(author.titles).toEqual([]);
        // Told the relation is not the public's, not that a read failed.
        expect(author.note).toContain(`Visitors can't read "staffPicks"`);
      });

      it("lists an outer item's relation from the row the public read, without the one it may not read", async () => {
        const { entry, stored } = await shelf();
        // The row an outer list of shelves hands each item.
        const { items } = await createPublicReader(t.nextly, {
          locale: "en",
        }).find({
          collection: SHELVES,
          filters: [{ field: "id", op: "equals", value: String(entry.id) }],
        });
        const item = items[0];
        expect(item).toBeDefined();
        expect(item !== undefined && "staffPicks" in item).toBe(false);
        const inner = { item: item ?? {}, itemSource: SHELVES };
        const ofItem = (field: string) => ({
          collection: CATS,
          relation: { of: "item", field },
        });
        expect((await drawn(ofItem("categories"), inner)).titles).toEqual(
          stored
        );
        expect((await drawn(ofItem("staffPicks"), inner)).titles).toEqual([]);
      });
    });

    describe("a sorted related source of more entries than one read takes", () => {
      /** How many entries the board holds: more than a read's 100. */
      const MANY = 150;
      let board: Row = {};

      beforeAll(async () => {
        // Titles that repeat and differ by case, and some empty, so the
        // order is the database's collation, empty values last and ties by
        // id: what no merge outside the database could repeat.
        const words = ["apple", "Apple", "Banana", "banana", "cherry", ""];
        const tagIds: string[] = [];
        for (let index = 0; index < MANY; index += 1) {
          const created = await t.nextly.create({
            collection: TAGS,
            data: {
              title: words[index % words.length],
              rank: index % 7,
              status: "published",
            },
            overrideAccess: true,
          });
          tagIds.push(String(created.item.id));
        }
        const created = await t.nextly.create({
          collection: BOARDS,
          data: {
            title: "Board",
            // Stored against the id order, so no read order is the stored one.
            tags: [...tagIds].reverse(),
            status: "published",
          },
          overrideAccess: true,
        });
        board = (await t.nextly.findByID({
          collection: BOARDS,
          id: String(created.item.id),
          depth: 0,
          overrideAccess: true,
        })) as Row;
      });

      /** Every tag's id in the database's own order for `sort`, read whole. */
      async function databaseOrder(sort: string): Promise<string[]> {
        const reader = createPublicReader(t.nextly, { locale: "en" });
        const order: string[] = [];
        for (let offset = 0; offset < MANY; offset += 100) {
          const { items } = await reader.find({
            collection: TAGS,
            sort,
            limit: 100,
            offset,
          });
          order.push(...items.map(item => String(item.id)));
        }
        return order;
      }

      /**
       * The public reader, bounded as the canvas's route bounds a read: at
       * most 100 values in a filter and 100 rows a read.
       */
      function boundedData(): PageContext["data"] {
        const data = createDefaultDataProvider(
          createPublicReader(t.nextly, { locale: "en" })
        );
        return {
          find: async query => {
            const wide = (query.filters ?? []).some(
              row => Array.isArray(row.value) && row.value.length > 100
            );
            if (wide || (query.limit ?? 10) > 100) {
              throw new Error("A read names more than 100 values.");
            }
            return await data.find(query);
          },
        };
      }

      it.each([
        ["title", 40, 30],
        ["-title", 90, 20],
        ["rank,-title", 0, 100],
        ["title", 120, 50],
      ])(
        "sorts by %s across every read, then skips %i and shows %i",
        async (sort, offset, limit) => {
          const listed = await drawn(
            {
              collection: TAGS,
              relation: { of: "entry", field: "tags" },
              sort,
              offset,
              limit,
            },
            {
              entry: board,
              entryCollection: BOARDS,
              diagnostics: true,
              data: boundedData(),
            },
            "id"
          );
          expect(listed.note).toBeNull();
          expect(listed.titles).toEqual(
            (await databaseOrder(sort)).slice(offset, offset + limit)
          );
        }
      );
    });

    it("lists a stored loop sorted by a field the public may not read in id order, and tells an author", async () => {
      const all = await titlesOf({});
      const visitor = await drawn({
        collection: POSTS,
        sort: "-secret",
        limit: 100,
      });
      expect(visitor.titles).toEqual(all);
      expect(visitor.note).toBeNull();

      const author = await drawn(
        { collection: POSTS, sort: "-secret", limit: 100 },
        { diagnostics: true }
      );
      expect(author.titles).toEqual(all);
      expect(author.note).toContain('"secret"');
      expect(author.note).toContain("ID order");
    });
  }
);
