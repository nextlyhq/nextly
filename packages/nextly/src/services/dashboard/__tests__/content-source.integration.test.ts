/**
 * `system:content`, the dashboard's Content table, against a real database on
 * every dialect: each reader's own rows, counted as that reader, their drafts
 * by the collection list's own Draft filter, each row's last update from its
 * own data (a collection's newest entry that reader may read, a Single's
 * document), who saved it as the trail lets that reader see, and a + only where
 * they may create. Then the bound: with sixty collections, one load counts and
 * reads the rows it draws and no others.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { runWithAccessMemo } from "../../../auth/access/request-memo";
import { defineCollection, defineSingle, text } from "../../../config";
import { refreshCollectionSources } from "../../../domains/widgets/collection-sources";
import { executeWidgetQuery } from "../../../domains/widgets/execute";
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

/** The Single's document, made by a first read, last updated at `updatedAt`. */
async function singleUpdatedAt(
  t: TestNextly,
  slug: string,
  updatedAt: Date
): Promise<void> {
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
}

interface TrailRow {
  id: string;
}

/**
 * `person` saving `entryId` at `when`, as the trail records a save: written
 * through the service, then given its instant, so the order is the case's own.
 */
async function saved(
  t: TestNextly,
  person: typeof ANA,
  collection: string,
  entryId: string,
  when: Date
): Promise<void> {
  const trail = () => t.adapter.select<TrailRow>("activity_log");
  const before = new Set((await trail()).map(row => row.id));
  await t.getService("activityLogService").logActivity({
    actorType: "user",
    userId: person.id,
    action: "update",
    collection,
    entryId,
    entryTitle: "Saved",
    subjectKind: "collection",
    metadata: { changedFields: ["title"] },
  });
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
  "the Content table's bounded load (integration, %s)",
  dialect => {
    it("counts and reads the rows it draws and no others, with sixty collections", async () => {
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
      // Two saved collections, so the page is not merely the first by label.
      const late = SIXTY[47]!;
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
      // The newest entry is read for the drawn collections alone, too.
      const read = new Set(
        find.mock.calls.map(([args]) =>
          String((args as { collection: unknown }).collection)
        )
      );
      expect([...read].every(slug => drawn.includes(slug))).toBe(true);
      expect(read.size).toBe(6);
      // "View all (N)" counts every collection without counting an entry.
      expect(answer.total).toBe(60);
    });
  }
);
