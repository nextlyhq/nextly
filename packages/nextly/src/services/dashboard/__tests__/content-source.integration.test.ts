/**
 * `system:content`, the dashboard's Content table, against a real database on
 * every dialect: each reader's own rows, counted as that reader, their drafts
 * by the collection list's own Draft filter, each row's last update from its
 * own data (a collection's newest entry that reader may read, a Single's
 * document), who saved it as the trail lets that reader see, and a + only where
 * they may create. Then the ranking: each row by its own last update, though
 * one collection's saves fill the trail's window; a Single's Updated and its
 * saver taken together from its save past that window; and a publish on its
 * own shown as the publish it was, by whoever made it. Then the bound: with sixty collections, one load
 * counts the rows it draws and no others, and reads the newest entry of at most
 * fifty, every one the trail's window names among them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { runWithAccessMemo } from "../../../auth/access/request-memo";
import { defineCollection, defineSingle, text } from "../../../config";
import { refreshCollectionSources } from "../../../domains/widgets/collection-sources";
import { executeWidgetQuery } from "../../../domains/widgets/execute";
import { MAX_WIDGET_LIMIT } from "../../../domains/widgets/query-limits";
import { CONTENT_SOURCE_ID } from "../../../domains/widgets/system-source-ids";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../readable-resources";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run on a reused database.
const ARTICLES = "cs_articles";
const TAGS = "cs_tags";
const EMPTY = "cs_empty";
const HIDDEN = "cs_hidden";
const HOME = "cs-home";
const BUSY = "cs_busy";
const ARCHIVE = "cs_archive";
const NEWS = "cs_news";
/** Sixty collections, more than any page of the card. */
const SIXTY = Array.from(
  { length: 60 },
  (_, i) => `cs_m${String(i).padStart(2, "0")}`
);

const ANA = { id: "cs-ana", name: "Ana", email: "ana@cs.test" };
const BEN = { id: "cs-ben", name: "Ben", email: "ben@cs.test" };

const T0 = Date.parse("2026-10-23T12:00:00Z");
/** Long before the trail's window, and before any save it records. */
const LONG_AGO = new Date("2024-01-05T08:00:00Z");
/** `minutes` before T0. */
const at = (minutes: number) => new Date(T0 - minutes * 60_000);

/**
 * A read rule's answer as the rule's type is written: a rule may answer a
 * filter, which the declared return type does not spell.
 */
const answering = (value: unknown) => value as boolean;

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    collections: [
      // Draft/Published, read whole by Ana and only its "shared" entries by Ben.
      defineCollection({
        slug: ARTICLES,
        status: true,
        access: {
          read: ({ user }: { user?: { id?: string } | null }) =>
            user?.id === ANA.id
              ? true
              : answering({ title: { equals: "shared" } }),
        },
        fields: [text({ name: "title" })],
      }),
      // No lifecycle, so no drafts to count.
      defineCollection({
        slug: TAGS,
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
      // Readable and holding nothing.
      defineCollection({
        slug: EMPTY,
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: HIDDEN,
        admin: { hidden: true },
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: HOME,
        label: { singular: "Home" },
        access: { read: () => true },
        fields: [text({ name: "headline" })],
      }),
    ],
  });
  current = t;
  for (const person of [ANA, BEN]) {
    await t.adapter.insert("users", { ...person, is_active: true });
    // A code rule only narrows the permission, so each reader holds read on
    // everything here and the rules decide what they see.
    await grantTo(t, person.id, "read", [ARTICLES, TAGS, EMPTY, HIDDEN, HOME]);
  }
  // Ana may create articles; nobody else may create anything.
  await grantTo(t, ANA.id, "create", [ARTICLES]);
  return t;
}

const as = (person: { id: string }): ReadCaller => ({
  user: { id: person.id, roles: [] },
});

/**
 * A new entry of `collection`, last updated at `updatedAt`: a write stamps its
 * own instant, so the instant is set on the row, as the case states it.
 */
async function entry(
  t: TestNextly,
  collection: string,
  data: Record<string, unknown>,
  updatedAt: Date
): Promise<string> {
  const created = await t.nextly.create({
    collection: collection as never,
    data: data as never,
  });
  const id = String((created.item as { id: unknown }).id);
  await t.adapter.update(
    `dc_${collection}`,
    { updated_at: updatedAt },
    { and: [{ column: "id", op: "=", value: id }] }
  );
  return id;
}

/**
 * The Single's document, made by a first read, last updated at `updatedAt`;
 * its id, as the trail names it.
 */
async function singleUpdatedAt(
  t: TestNextly,
  slug: string,
  updatedAt: Date
): Promise<string> {
  await t.nextly.findSingle({ slug: slug as never });
  const registry = t.getService("singleRegistryService") as unknown as {
    getSingleBySlug: (slug: string) => Promise<{ tableName: string } | null>;
  };
  const single = await registry.getSingleBySlug(slug);
  if (single === null) throw new Error(`no Single ${slug}`);
  const row = await t.adapter.selectOne<{ id: string }>(single.tableName, {
    columns: ["id"],
  });
  if (row === null) throw new Error(`no document for ${slug}`);
  await t.adapter.update(
    single.tableName,
    { updated_at: updatedAt },
    { and: [{ column: "id", op: "=", value: row.id }] }
  );
  return String(row.id);
}

interface TrailRow {
  id: string;
}

/** `person` saving `entryId` at `when`, as `savedEach` records it. */
async function saved(
  t: TestNextly,
  person: typeof ANA,
  collection: string,
  entryId: string,
  when: Date
): Promise<void> {
  await savedEach(t, person, collection, [entryId], when);
}

/** What the trail records of an edit: the fields it changed. */
const EDIT = { changedFields: ["title"] };
/** What the trail records of a publish on its own: the status, and that it went live. */
const PUBLISH = { changedFields: ["status"], published: true };

/**
 * `person` saving each of `entryIds` at `when`, as the trail records a save:
 * written through the service, then given its instant, so the order is the
 * case's own. A collection's entries unless `subjectKind` says a Single's; an
 * edit unless `metadata` says otherwise.
 */
async function savedEach(
  t: TestNextly,
  person: typeof ANA,
  collection: string,
  entryIds: readonly string[],
  when: Date,
  subjectKind: "collection" | "single" = "collection",
  metadata: Record<string, unknown> = EDIT
): Promise<void> {
  const trail = () => t.adapter.select<TrailRow>("activity_log");
  const before = new Set((await trail()).map(row => row.id));
  for (const entryId of entryIds) {
    await t.getService("activityLogService").logActivity({
      actorType: "user",
      userId: person.id,
      action: "update",
      collection,
      entryId,
      entryTitle: "Saved",
      subjectKind,
      metadata,
    });
  }
  for (const row of (await trail()).filter(row => !before.has(row.id))) {
    await t.adapter.update(
      "activity_log",
      { created_at: when },
      { and: [{ column: "id", op: "=", value: row.id }] }
    );
  }
}

/**
 * The Content card's answer for `caller`, within one request's access memo, as
 * the dashboard's query route asks it (`routeHandler` runs every request in
 * `runWithAccessMemo`). A read rule answering a filter admits its collection
 * only where the request can keep that filter for the reads it lets run;
 * outside a request it refuses, so the reader's row would be missing for a
 * reason the dashboard never meets.
 */
async function contentTable(
  caller: ReadCaller,
  limit = 10
): Promise<{ items: Record<string, unknown>[]; total?: number }> {
  const answer = await runWithAccessMemo(() =>
    executeWidgetQuery({ source: CONTENT_SOURCE_ID, op: "list", limit }, caller)
  );
  if (answer.op !== "list") throw new Error(`answered ${answer.op}`);
  return answer;
}

describe.each(getConfiguredTestDialects())(
  "the Content table's source (integration, %s)",
  dialect => {
    async function seeded(): Promise<TestNextly> {
      const t = await boot(dialect);
      const sharedDraft = await entry(
        t,
        ARTICLES,
        { title: "shared", status: "draft" },
        at(30)
      );
      await entry(
        t,
        ARTICLES,
        { title: "shared", status: "published" },
        at(40)
      );
      // The newest article, which Ben may not read.
      const privateDraft = await entry(
        t,
        ARTICLES,
        { title: "private", status: "draft" },
        at(10)
      );
      await entry(t, ARTICLES, { title: "private", status: "draft" }, at(50));
      const tag = await entry(t, TAGS, { title: "tag" }, at(20));
      // Home last updated long before any save the trail holds.
      await singleUpdatedAt(t, HOME, LONG_AGO);
      await saved(t, BEN, ARTICLES, sharedDraft, at(30));
      await saved(t, ANA, TAGS, tag, at(20));
      // The newest save of all, of an entry Ben may not read.
      await saved(t, ANA, ARTICLES, privateDraft, at(10));
      // The record of which collections turn creating off, as every dashboard
      // request refreshes it before a widget query.
      await refreshCollectionSources();
      return t;
    }

    it("answers each reader their own counts, drafts, last save and create button, and leaves a hidden one out", async () => {
      await seeded();

      const ana = await contentTable(as(ANA));
      expect(ana.items.map(row => `${row.kind}:${row.slug}`)).toEqual([
        `collection:${ARTICLES}`,
        `collection:${TAGS}`,
        `single:${HOME}`,
        // Holding nothing: last, whatever its label.
        `collection:${EMPTY}`,
      ]);
      expect(ana.items[0]).toMatchObject({
        count: 4,
        draft: 3,
        canCreate: true,
        updatedAt: at(10).toISOString(),
        userName: ANA.name,
      });
      expect(ana.items[1]).toMatchObject({
        count: 1,
        draft: null,
        canCreate: false,
        updatedAt: at(20).toISOString(),
      });
      expect(ana.items[3]).toMatchObject({ count: 0 });
      // Kept off the dashboard for every reader, though readable to this one.
      expect(ana.items.some(row => row.slug === HIDDEN)).toBe(false);
      // 🔴 Every row the table could show Ana, Home's included: the list
      // answer's total is the rows it matched.
      expect(ana.total).toBe(4);

      const ben = await contentTable(as(BEN));
      const benArticles = ben.items.find(row => row.slug === ARTICLES);
      // 🔴 Ben's own: the two entries his rule lets him read, one a draft, the
      // newer of them, and his save of it. Ana's later entry and save, which
      // he may not read, neither date his row nor name her.
      expect(benArticles).toMatchObject({
        count: 2,
        draft: 1,
        canCreate: false,
        updatedAt: at(30).toISOString(),
        userName: BEN.name,
      });
      // Ordered by what Ben may see: the tag is newer than the newest article he may read.
      expect(ben.items.map(row => row.slug).slice(0, 2)).toEqual([
        TAGS,
        ARTICLES,
      ]);
      expect(ben.items.some(row => row.slug === HIDDEN)).toBe(false);
    });

    it("dates a Single by its own document, last saved long before anything the trail holds", async () => {
      await seeded();
      const home = (await contentTable(as(ANA))).items.find(
        row => row.slug === HOME
      );
      // 🔴 Its date, not "—": the trail holds no save of it.
      expect(home).toMatchObject({
        kind: "single",
        updatedAt: LONG_AGO.toISOString(),
      });
      expect(home).not.toHaveProperty("userName");
    });

    it("counts each reader's drafts as the collection list's Draft filter finds them", async () => {
      const t = await seeded();
      for (const person of [ANA, BEN]) {
        const row = (await contentTable(as(person))).items.find(
          item => item.slug === ARTICLES
        );
        // The list's own read: every entry, narrowed by `where`, as the reader.
        const list = await t.nextly.find({
          collection: ARTICLES as never,
          overrideAccess: false,
          user: as(person).user,
          status: "all",
          where: { status: { equals: "draft" } },
          limit: 1,
        });
        expect(row?.draft, person.id).toBe(list.meta.total);
      }
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "the Content table's ranking (integration, %s)",
  dialect => {
    it("ranks each collection by its own last update, though one collection's saves fill the trail's window", async () => {
      const slugs = [BUSY, ARCHIVE, NEWS];
      const t = await createTestNextly({
        dialect,
        collections: slugs.map(slug =>
          defineCollection({
            slug,
            access: { read: () => true },
            fields: [text({ name: "title" })],
          })
        ),
      });
      current = t;
      await t.adapter.insert("users", { ...ANA, is_active: true });
      await grantTo(t, ANA.id, "read", slugs);
      // First by label, and untouched for years.
      await entry(t, ARCHIVE, { title: "old" }, LONG_AGO);
      const news = await entry(t, NEWS, { title: "news" }, at(30));
      await saved(t, ANA, NEWS, news, at(30));
      // More entries of busy, each saved since, than the trail's window holds,
      // so news's latest save lies past the window.
      const busy: string[] = [];
      for (let i = 0; i <= MAX_WIDGET_LIMIT; i++) {
        busy.push(await entry(t, BUSY, { title: `busy ${i}` }, at(5)));
      }
      await savedEach(t, ANA, BUSY, busy, at(5));

      const answer = await contentTable(as(ANA), 2);

      // 🔴 News is drawn, after busy and in place of the older archive.
      expect(answer.items.map(row => row.slug)).toEqual([BUSY, NEWS]);
      expect(answer.items[1]).toMatchObject({
        updatedAt: at(30).toISOString(),
        userName: ANA.name,
      });
      expect(answer.total).toBe(3);
    });

    it("takes a Single's Updated and who saved it together from its save past the trail's window", async () => {
      const t = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: BUSY,
            access: { read: () => true },
            fields: [text({ name: "title" })],
          }),
        ],
        singles: [
          defineSingle({
            slug: HOME,
            label: { singular: "Home" },
            access: { read: () => true },
            fields: [text({ name: "headline" })],
          }),
        ],
      });
      current = t;
      // Both people have accounts: the trail names an actor from the account
      // it finds when it writes the save, and records one it cannot find as
      // erased, with no name.
      for (const person of [ANA, BEN]) {
        await t.adapter.insert("users", { ...person, is_active: true });
      }
      await grantTo(t, ANA.id, "read", [BUSY, HOME]);
      // Home's document, saved by Ben before any of busy's saves.
      const home = await singleUpdatedAt(t, HOME, at(30));
      await savedEach(t, BEN, HOME, [home], at(30), "single");
      // More entries of busy, each saved since, than the trail's window holds,
      // so Home's save lies past the window.
      const busy: string[] = [];
      for (let i = 0; i <= MAX_WIDGET_LIMIT; i++) {
        busy.push(await entry(t, BUSY, { title: `busy ${i}` }, at(5)));
      }
      await savedEach(t, ANA, BUSY, busy, at(5));

      const answer = await contentTable(as(ANA), 2);

      // 🔴 Ben's save, though the window holds only busy's: its instant and
      // his name together.
      expect(answer.items.find(row => row.slug === HOME)).toMatchObject({
        kind: "single",
        slug: HOME,
        updatedAt: at(30).toISOString(),
        userName: BEN.name,
      });
      expect(answer.total).toBe(2);
    });

    it("shows a publish on its own as the latest change, its instant and who published together", async () => {
      const t = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: NEWS,
            status: true,
            access: { read: () => true },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      current = t;
      for (const person of [ANA, BEN]) {
        await t.adapter.insert("users", { ...person, is_active: true });
      }
      await grantTo(t, ANA.id, "read", [NEWS]);
      // Ana writes the story; Ben later publishes it, changing nothing else,
      // which moves the entry's own instant too.
      const story = await entry(
        t,
        NEWS,
        { title: "story", status: "draft" },
        at(10)
      );
      await saved(t, ANA, NEWS, story, at(20));
      await savedEach(t, BEN, NEWS, [story], at(10), "collection", PUBLISH);

      const [row] = (await contentTable(as(ANA))).items;

      // 🔴 Ben's publish, not Ana's save beside the publish's instant.
      expect(row).toMatchObject({
        slug: NEWS,
        updatedAt: at(10).toISOString(),
        userName: BEN.name,
        event: "published",
      });
    });

    it("ranks a row by a save newer than its live entry, as it shows it", async () => {
      const t = await createTestNextly({
        dialect,
        collections: [NEWS, ARCHIVE].map(slug =>
          defineCollection({
            slug,
            access: { read: () => true },
            fields: [text({ name: "title" })],
          })
        ),
      });
      current = t;
      for (const person of [ANA, BEN]) {
        await t.adapter.insert("users", { ...person, is_active: true });
      }
      await grantTo(t, ANA.id, "read", [NEWS, ARCHIVE]);
      const old = await entry(t, ARCHIVE, { title: "old" }, at(10));
      await saved(t, ANA, ARCHIVE, old, at(10));
      // A save of the published story kept as its working draft: the trail
      // files it now, and the live entry keeps its earlier stamp.
      const story = await entry(t, NEWS, { title: "story" }, at(30));
      await saved(t, BEN, NEWS, story, at(5));

      // A card with room for one row.
      const answer = await contentTable(as(ANA), 1);

      // 🔴 The story, showing Ben's save: ranked by its live stamp, the
      // archive would take the row though it shows an older time.
      expect(answer.items.map(row => row.slug)).toEqual([NEWS]);
      expect(answer.items[0]).toMatchObject({
        updatedAt: at(5).toISOString(),
        userName: BEN.name,
      });
    });

    it("shows a row's own date and no name where the trail's latest change is older than it", async () => {
      const t = await createTestNextly({
        dialect,
        collections: [
          defineCollection({
            slug: NEWS,
            access: { read: () => true },
            fields: [text({ name: "title" })],
          }),
        ],
      });
      current = t;
      await t.adapter.insert("users", { ...ANA, is_active: true });
      await grantTo(t, ANA.id, "read", [NEWS]);
      // Ana's save of the story, then a later write the trail did not record.
      const story = await entry(t, NEWS, { title: "story" }, at(5));
      await saved(t, ANA, NEWS, story, at(20));

      const [row] = (await contentTable(as(ANA))).items;

      // 🔴 The story's own, newer instant, which the row is ranked by, and
      // nobody named for a write the trail does not say who made.
      expect(row).toMatchObject({ slug: NEWS, updatedAt: at(5).toISOString() });
      expect(row).not.toHaveProperty("userName");
      expect(row).not.toHaveProperty("event");
    });
  }
);

describe.each(getConfiguredTestDialects())(
  "the Content table's bounded load (integration, %s)",
  dialect => {
    it("counts the rows it draws and no others, and reads the newest entry of at most fifty of sixty collections, every one the window names among them", async () => {
      const t = await createTestNextly({
        dialect,
        collections: SIXTY.map(slug =>
          defineCollection({
            slug,
            access: { read: () => true },
            fields: [text({ name: "title" })],
          })
        ),
      });
      current = t;
      await t.adapter.insert("users", { ...ANA, is_active: true });
      await grantTo(t, ANA.id, "read", SIXTY);
      // Two saved collections, so the page is not merely the first by label;
      // one of them past the first fifty by label.
      const late = SIXTY[55]!;
      const later = SIXTY[23]!;
      const lateEntry = await entry(t, late, { title: "a" }, at(20));
      await saved(t, ANA, late, lateEntry, at(20));
      const laterEntry = await entry(t, later, { title: "b" }, at(10));
      await saved(t, ANA, later, laterEntry, at(10));

      // Every count and read of entries the load makes, as the reader, through
      // the ordinary paths.
      const count = vi.spyOn(t.nextly, "count");
      const find = vi.spyOn(t.nextly, "find");
      const answer = await contentTable(as(ANA), 6);

      const drawn = answer.items.map(row => String(row.slug));
      expect(drawn).toHaveLength(6);
      expect(drawn.slice(0, 2)).toEqual([later, late]);
      const counted = count.mock.calls.map(([args]) =>
        String((args as { collection: unknown }).collection)
      );
      // 🔴 Exactly the drawn rows: a table that counted all sixty and kept six
      // draws the same rows, and only the counts tell the two apart.
      expect(new Set(counted)).toEqual(new Set(drawn));
      // Entries alone here: no collection has the lifecycle, so no drafts.
      expect(counted).toHaveLength(6);
      // Each collection's newest entry ranks the page: read once for each of
      // fifty. The trail's own reads, which authorize a save by its id, ask by
      // `where`.
      const read = find.mock.calls
        .map(([args]) => args as { collection: unknown; sort?: unknown })
        .filter(args => args.sort === "-updatedAt")
        .map(args => String(args.collection));
      // 🔴 At most fifty, each once: the two the window names, `late` among
      // them though it is past the first fifty by label, then the first by
      // label. The last by label is never read.
      expect(read).toHaveLength(MAX_WIDGET_LIMIT);
      expect(new Set(read).size).toBe(MAX_WIDGET_LIMIT);
      expect(read).toContain(late);
      expect(read).not.toContain(SIXTY[59]);
      // Every row the table could show, counted without counting an entry.
      expect(answer.total).toBe(60);
    });
  }
);
