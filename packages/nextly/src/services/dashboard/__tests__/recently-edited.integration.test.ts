/**
 * Recently edited, from the activity trail, through a booted instance on every
 * dialect.
 *
 * What only a booted instance shows: the real write paths record what makes a
 * save a save (a publish marks its row, a held edit is recorded as the edit it
 * is, a Single names the fields it changed), and the card's source reads them
 * back one row per document, across every collection the reader may read and
 * no cap on how many, as that reader, each with its status now.
 *
 * @module services/dashboard/__tests__/recently-edited.integration.test
 */

import { randomUUID } from "crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import {
  refreshEndpointPresence,
  setWebhookAuditEnabled,
} from "../../../domains/webhooks/recording-activation";
import { executeWidgetQuery } from "../../../domains/widgets/execute";
import type { WidgetQuery } from "../../../domains/widgets/query";
import type { WidgetResult } from "../../../domains/widgets/result";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../readable-resources";
import { RECENT_EDITS_SOURCE_ID } from "../recent-edits-widget-source";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run on a reused database.
const NOTES = "re_notes";
const PAGES = "re_pages";
const SECRET = "re_secret";
const HOME = "re-home";
/** More collections than the cross-collection read it replaces ever looked at. */
const MANY = Array.from({ length: 22 }, (_, i) => `re_c${i}`);

const ANA = { id: "re-ana", name: "Ana", email: "ana@re.test" };
const BEN = { id: "re-ben", name: "Ben", email: "ben@re.test" };
/** The one person `SECRET`'s rule lets read it. */
const BOSS = { id: "re-boss", name: "Boss", email: "boss@re.test" };

const T0 = Date.parse("2026-10-23T12:00:00Z");
/** `minutes` before T0. */
const at = (minutes: number) => new Date(T0 - minutes * 60_000);

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const card = () =>
  defineFieldGroup({ slug: "re_card", fields: [text({ name: "caption" })] });

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    fieldGroups: [card()],
    collections: [
      defineCollection({
        slug: NOTES,
        // Draft/Published, without versions: an edit writes the live row.
        status: true,
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: PAGES,
        // With versions: an edit to a published page is held as a draft.
        status: true,
        versions: true,
        access: { read: () => true },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: SECRET,
        access: {
          read: ({ user }: { user?: { id?: string } | null }) =>
            user?.id === BOSS.id,
        },
        fields: [text({ name: "title" })],
      }),
      ...MANY.map(slug =>
        defineCollection({
          slug,
          access: { read: () => true },
          fields: [text({ name: "title" })],
        })
      ),
    ],
    singles: [
      defineSingle({
        slug: HOME,
        label: { singular: "Home" },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "headline" }),
          fieldGroup({ name: "hero", component: "re_card" }),
        ],
      }),
    ],
  });
  current = t;
  for (const person of [ANA, BEN, BOSS]) {
    await t.adapter.insert("users", { ...person, is_active: true });
  }
  return t;
}

interface TrailRow {
  id: string;
  action: string;
  collection: string;
  entryId: string | null;
  metadata: string | Record<string, unknown> | null;
}

const trail = (t: TestNextly) => t.adapter.select<TrailRow>("activity_log");

/**
 * Runs `write`, then gives every row it added to the trail the instant `when`,
 * so the rows' order is the cases' own: on MySQL and SQLite, writes in one
 * second would otherwise tie, broken by a random id.
 */
async function written(
  t: TestNextly,
  when: Date,
  write: () => Promise<unknown>
): Promise<TrailRow[]> {
  const before = new Set((await trail(t)).map(row => row.id));
  await write();
  const added = (await trail(t)).filter(row => !before.has(row.id));
  for (const row of added) {
    await t.adapter.update(
      "activity_log",
      { created_at: when },
      { and: [{ column: "id", op: "=", value: row.id }] }
    );
  }
  return added;
}

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as {
    createEntry: (
      p: Record<string, unknown>,
      data: Record<string, unknown>
    ) => Promise<{ data: unknown }>;
    updateEntry: (
      p: Record<string, unknown>,
      data: Record<string, unknown>
    ) => Promise<unknown>;
  };
}

/** The write context of `person` saving in `collection`, as the admin's own writes carry it. */
const asPerson = (person: typeof ANA, collection: string) => ({
  collectionName: collection,
  overrideAccess: true,
  user: { id: person.id, email: person.email },
  actor: { type: "user", id: person.id },
});

async function create(
  t: TestNextly,
  person: typeof ANA,
  collection: string,
  data: Record<string, unknown>,
  when: Date
): Promise<string> {
  let id = "";
  await written(t, when, async () => {
    const created = await handlerOf(t).createEntry(
      asPerson(person, collection),
      data
    );
    id = (created.data as { id: string }).id;
  });
  return id;
}

function save(
  t: TestNextly,
  person: typeof ANA,
  collection: string,
  entryId: string,
  data: Record<string, unknown>,
  when: Date
) {
  return written(t, when, () =>
    handlerOf(t).updateEntry({ ...asPerson(person, collection), entryId }, data)
  );
}

const as = (person: { id: string }): ReadCaller => ({
  user: { id: person.id, roles: [] },
});

async function recentlyEdited(
  caller: ReadCaller,
  query: Partial<WidgetQuery> = {}
): Promise<Record<string, unknown>[]> {
  const answer: WidgetResult = await executeWidgetQuery(
    { source: RECENT_EDITS_SOURCE_ID, op: "list", limit: 25, ...query },
    caller
  );
  return answer.op === "list" ? answer.items : [];
}

const metadataOf = (row: TrailRow): Record<string, unknown> =>
  typeof row.metadata === "string"
    ? (JSON.parse(row.metadata) as Record<string, unknown>)
    : (row.metadata ?? {});

describe.each(getConfiguredTestDialects())(
  "Recently edited from the activity trail (integration, %s)",
  dialect => {
    it("lists the latest save of each document across more than twenty collections, newest first", async () => {
      const t = await boot(dialect);
      const ids: string[] = [];
      for (const [i, slug] of MANY.entries()) {
        ids.push(await create(t, ANA, slug, { title: `Doc ${i}` }, at(i + 1)));
      }

      const rows = await recentlyEdited(as(ANA));
      // 🔴 Every one of the twenty-two: the read it replaces stopped at twenty
      // collections, so the oldest two never appeared.
      expect(rows.map(row => row.entryId)).toEqual(ids);
      expect(rows[0]).toMatchObject({
        entryTitle: "Doc 0",
        collection: MANY[0],
        userId: ANA.id,
        userName: ANA.name,
        status: null,
      });
    });

    it("shows a document saved three times once, at its latest save", async () => {
      const t = await boot(dialect);
      const id = await create(t, ANA, NOTES, { title: "one" }, at(10));
      await save(t, ANA, NOTES, id, { title: "two" }, at(5));
      const [latest] = await save(t, BEN, NOTES, id, { title: "three" }, at(1));

      const rows = await recentlyEdited(as(ANA));
      expect(rows.map(row => [row.entryId, row.id, row.userId])).toEqual([
        [id, latest!.id, BEN.id],
      ]);
      expect(rows[0]).toMatchObject({ entryTitle: "three", status: "draft" });
    });

    it("keeps the editor's save when someone else only publishes it, and labels it published", async () => {
      const t = await boot(dialect);
      const id = await create(t, ANA, NOTES, { title: "draft" }, at(10));
      const [edit] = await save(t, ANA, NOTES, id, { title: "edited" }, at(5));
      // A publish on its own: the status and the write's own stamps change.
      await save(t, BEN, NOTES, id, { status: "published" }, at(1));

      const rows = await recentlyEdited(as(ANA));
      expect(rows.map(row => [row.id, row.userId, row.status])).toEqual([
        [edit!.id, ANA.id, "published"],
      ]);
      expect(rows[0]?.createdAt).toBe(at(5).toISOString());
    });

    it("shows a held edit of a published page as changes not published, until a promotion puts it live", async () => {
      const t = await boot(dialect);
      const id = await create(
        t,
        BEN,
        PAGES,
        { title: "live", status: "published" },
        at(10)
      );
      // No `status`: held as a working draft on the published page.
      const [held] = await save(t, ANA, PAGES, id, { title: "pending" }, at(5));

      const pending = await recentlyEdited(as(BEN));
      expect(pending.map(row => [row.id, row.userId])).toEqual([
        [held!.id, ANA.id],
      ]);
      expect(pending[0]).toMatchObject({
        status: "published",
        pendingChanges: true,
      });

      // Ben publishes Ana's pending edits. The status stays published, so only
      // the row's mark says it was a publish.
      const [promotion] = await save(
        t,
        BEN,
        PAGES,
        id,
        { status: "published" },
        at(1)
      );
      expect(metadataOf(promotion!)).toMatchObject({ published: true });

      const live = await recentlyEdited(as(BEN));
      // 🔴 Still Ana's save at its own time: the promotion published her edits
      // and made none of its own.
      expect(live.map(row => [row.id, row.userId])).toEqual([
        [held!.id, ANA.id],
      ]);
      expect(live[0]).toMatchObject({
        status: "published",
        pendingChanges: false,
      });
    });

    it("fills the card from older readable saves when the newest are all of a collection the reader may not read", async () => {
      const t = await boot(dialect);
      const readable = await create(t, ANA, NOTES, { title: "mine" }, at(500));
      const secret = await create(t, BOSS, SECRET, { title: "hush" }, at(400));
      // More than one page of the walk, every one a save Ana may not read.
      await t.adapter.insertMany(
        "activity_log",
        Array.from({ length: 150 }, (_, i) => ({
          id: randomUUID(),
          actor_type: "user",
          user_id: BOSS.id,
          user_name: BOSS.name,
          user_email: BOSS.email,
          action: "update",
          collection: SECRET,
          entry_id: secret,
          entry_title: "hush",
          subject_kind: "collection",
          metadata: JSON.stringify({ changedFields: ["title", "updatedAt"] }),
          created_at: new Date(T0 - i * 1_000),
        }))
      );

      expect((await recentlyEdited(as(ANA))).map(row => row.entryId)).toEqual([
        readable,
      ]);
      // The control: the reader the rule lets in sees the secret first.
      expect((await recentlyEdited(as(BOSS))).map(row => row.entryId)).toEqual([
        secret,
        readable,
      ]);
    });

    it("narrows to the reader's own saves and to one collection, and never takes a key's save for a person's", async () => {
      const t = await boot(dialect);
      const anas = await create(t, ANA, NOTES, { title: "Ana's" }, at(30));
      const bens = await create(t, BEN, NOTES, { title: "Ben's" }, at(20));
      const other = await create(
        t,
        ANA,
        MANY[0]!,
        { title: "Elsewhere" },
        at(10)
      );
      // A key whose id is the same string as Ana's, saving Ben's note last.
      await t.getService("activityLogService").logActivity({
        actorType: "apiKey",
        userId: ANA.id,
        action: "update",
        collection: NOTES,
        entryId: bens,
        entryTitle: "Ben's",
        subjectKind: "collection",
        metadata: { changedFields: ["title"] },
      });

      expect(
        (await recentlyEdited(as(ANA), { where: { onlyMine: true } })).map(
          row => row.entryId
        )
      ).toEqual([other, anas]);
      expect(
        (await recentlyEdited(as(ANA), { where: { collection: NOTES } })).map(
          row => row.entryId
        )
      ).toEqual([bens, anas]);
    });

    it("names the fields a Single's save changed, a component's included, with neither webhooks nor audit on", async () => {
      const t = await boot(dialect);
      // The harness turns audit on so outbox tests do not depend on endpoints;
      // this one is about the install where neither is on, and no endpoint
      // exists, so the presence read answers no.
      setWebhookAuditEnabled(false);
      await refreshEndpointPresence();
      const singles = t.getService("singleEntryService") as unknown as {
        update: (
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ) => Promise<{ success: boolean }>;
      };
      const actor = {
        overrideAccess: true,
        actor: { type: "user", id: ANA.id },
      };
      expect(
        (await singles.update(HOME, { headline: "Hi" }, actor)).success
      ).toBe(true);
      const outboxBefore = (await t.adapter.select("nextly_events")).length;
      // The control: with neither on, the first save recorded nothing either,
      // so an unchanged count below is the gate holding, not a count that
      // could not have moved.
      expect(outboxBefore).toBe(0);

      const [row] = await written(t, at(1), () =>
        singles.update(HOME, { hero: { caption: "New caption" } }, actor)
      );

      // 🔴 A component-only edit: compared as raw rows it changes nothing, as
      // the component lives in its own table.
      const changed = metadataOf(row!).changedFields;
      expect(changed).toContain("hero");
      expect(changed).not.toContain("headline");
      // The documents were assembled for the trail alone: no webhook payload
      // reached the outbox on an install with neither webhooks nor audit.
      expect((await t.adapter.select("nextly_events")).length).toBe(
        outboxBefore
      );
      expect(
        (await recentlyEdited(as(ANA))).map(edit => [
          edit.subjectKind,
          edit.collection,
        ])
      ).toEqual([["single", HOME]]);
    });
  }
);
