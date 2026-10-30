/**
 * Team activity's source on every dialect, read as the card reads it, through
 * the real access path: the reader's readable collections, then each row's
 * document judged as that reader.
 *
 * What only a booted instance shows: that the real write path's create, save,
 * publish, unpublish and delete of one entry come out as those five events,
 * newest first; and that a reader is answered only events about entries they
 * may read, so an event they may not read is neither drawn nor counted towards
 * the one row more that tells the card more exist. Two readers hold different
 * rights over the same trail, and each must-differ half has its control.
 *
 * @module services/dashboard/__tests__/team-activity.integration.test
 */

import { afterEach, describe, expect, it } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../../config";
import { EMAIL_PROVIDER_ACTIVITY_COLLECTION } from "../../../domains/email/provider-activity";
import { executeWidgetQuery } from "../../../domains/widgets/execute";
import type { WidgetResult } from "../../../domains/widgets/result";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { readActivitySubjects } from "../activity-subjects";
import { ACTIVITY_SOURCE_ID } from "../activity-widget-source";
import { someResources, type ReadCaller } from "../readable-resources";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run on a reused database.
const POSTS = "ta_posts";
const SECRET = "ta_secret";

const ANA = { id: "ta-ana", name: "Ana", email: "ana@ta.test" };
/** May read posts, and not secrets. */
const EDITOR = { id: "ta-editor", name: "Edi", email: "edi@ta.test" };
/** May read secrets, and not posts. */
const OUTSIDER = { id: "ta-outsider", name: "Out", email: "out@ta.test" };
/** May read both collections. */
const BOSS = { id: "ta-boss", name: "Boss", email: "boss@ta.test" };

const T0 = Date.parse("2026-10-22T12:00:00Z");
/** `minutes` before T0. */
const at = (minutes: number) => new Date(T0 - minutes * 60_000);

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface TrailRow {
  id: string;
}

interface Handler {
  createEntry: (
    p: Record<string, unknown>,
    data: Record<string, unknown>
  ) => Promise<{ data: unknown }>;
  updateEntry: (
    p: Record<string, unknown>,
    data: Record<string, unknown>
  ) => Promise<unknown>;
  deleteEntry: (p: Record<string, unknown>) => Promise<unknown>;
}

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: SECRET,
        status: true,
        fields: [text({ name: "title" })],
      }),
    ],
  });
  current = t;
  // Real accounts, so each write records its actor's name rather than an identity already erased.
  for (const person of [ANA, EDITOR, OUTSIDER, BOSS]) {
    await t.adapter.insert("users", { ...person, is_active: true });
  }
  await grantTo(t, ANA.id, "read", [POSTS, SECRET]);
  await grantTo(t, EDITOR.id, "read", [POSTS]);
  await grantTo(t, OUTSIDER.id, "read", [SECRET]);
  await grantTo(t, BOSS.id, "read", [POSTS, SECRET]);
  return t;
}

const trail = (t: TestNextly) => t.adapter.select<TrailRow>("activity_log");

/**
 * Runs `write`, then gives each row it added to the trail the instant `when`,
 * so the rows' order is the cases' own: on MySQL, writes in one second would
 * otherwise tie, and a random id would break the tie.
 */
async function written(
  t: TestNextly,
  when: Date,
  write: () => Promise<unknown>
): Promise<void> {
  const before = new Set((await trail(t)).map(row => row.id));
  await write();
  const added = (await trail(t)).filter(row => !before.has(row.id));
  expect(added).toHaveLength(1);
  await t.adapter.update(
    "activity_log",
    { created_at: when },
    { and: [{ column: "id", op: "=", value: added[0]!.id }] }
  );
}

/** Ana's writes to `collection`, through the ordinary write path. */
function writesTo(t: TestNextly, collection: string) {
  const handler = t.getService("collectionsHandler") as unknown as Handler;
  const asAna = {
    collectionName: collection,
    overrideAccess: true,
    user: { id: ANA.id, email: ANA.email },
    actor: { type: "user", id: ANA.id },
  };
  return {
    async create(when: Date, data: Record<string, unknown>): Promise<string> {
      let id = "";
      await written(t, when, async () => {
        const created = await handler.createEntry(asAna, data);
        id = (created.data as { id: string }).id;
      });
      return id;
    },
    update: (when: Date, entryId: string, data: Record<string, unknown>) =>
      written(t, when, () => handler.updateEntry({ ...asAna, entryId }, data)),
    remove: (when: Date, entryId: string) =>
      written(t, when, () => handler.deleteEntry({ ...asAna, entryId })),
  };
}

const as = (person: { id: string }): ReadCaller => ({
  user: { id: person.id, roles: [] },
});

/** The card's answer for `reader`, as the batch asks it: its rows. */
async function card(
  reader: ReadCaller,
  limit: number
): Promise<Record<string, unknown>[]> {
  const answer: WidgetResult = await executeWidgetQuery(
    { source: ACTIVITY_SOURCE_ID, op: "list", limit },
    reader
  );
  return answer.op === "list" ? answer.items : [];
}

describe.each(getConfiguredTestDialects())(
  "Team activity (integration, %s)",
  dialect => {
    it("names the real write path's create, save, publish and unpublish, newest first", async () => {
      const t = await boot(dialect);
      const posts = writesTo(t, POSTS);
      const id = await posts.create(at(4), { title: "Draft", status: "draft" });
      await posts.update(at(3), id, { title: "Edited" });
      await posts.update(at(2), id, { status: "published" });
      await posts.update(at(1), id, { status: "draft" });

      const rows = await card(as(EDITOR), 10);
      expect(rows.map(row => [row.entryId, row.event])).toEqual([
        [id, "unpublished"],
        [id, "published"],
        [id, "saved"],
        [id, "created"],
      ]);
    });

    it("names a deleted entry's deletion, and no event its dropped marks would have decided", async () => {
      const t = await boot(dialect);
      const posts = writesTo(t, POSTS);
      const id = await posts.create(at(4), { title: "Gone", status: "draft" });
      await posts.update(at(3), id, { status: "published" });
      await posts.remove(at(2), id);

      // The document is gone, so its history is kept without its title, id or marks: the
      // deletion and the creation still say what they were, by their action alone, and the
      // publish, which only its dropped marks said, names no event rather than reading as a save.
      const rows = await card(as(EDITOR), 10);
      expect(
        rows.map(row => [row.collection, row.action, row.event, row.entryId])
      ).toEqual([
        [POSTS, "delete", "deleted", null],
        [POSTS, "update", undefined, null],
        [POSTS, "create", "created", null],
      ]);
    });

    it("names no event for an entry's update that does not say what it did, nor for a settings change", async () => {
      const t = await boot(dialect);
      const id = await writesTo(t, POSTS).create(at(4), { title: "Post" });
      const log = t.getService("activityLogService");
      // An update recorded before the changed fields were: it may have been a publish.
      await written(t, at(3), () =>
        log.logActivity({
          actorType: "user",
          userId: ANA.id,
          action: "update",
          collection: POSTS,
          entryId: id,
          entryTitle: "Post",
          subjectKind: "collection",
        })
      );
      // An install-level settings change, which is no entry's or Single's event.
      await written(t, at(2), () =>
        log.logActivity({
          actorType: "user",
          userId: ANA.id,
          action: "update",
          collection: EMAIL_PROVIDER_ACTIVITY_COLLECTION,
          subjectKind: "settings",
          metadata: { changedFields: ["host"] },
        })
      );
      // The control: a save that says what it changed is named one.
      await writesTo(t, POSTS).update(at(1), id, { title: "Post 2" });

      const { activities } = await log.getRecentActivity({
        limit: 10,
        scope: someResources([POSTS, EMAIL_PROVIDER_ACTIVITY_COLLECTION]),
        caller: as(BOSS),
        ...(await readActivitySubjects()),
      });
      expect(
        activities.map(row => [row.collection, row.action, row.event])
      ).toEqual([
        [POSTS, "update", "saved"],
        [EMAIL_PROVIDER_ACTIVITY_COLLECTION, "update", undefined],
        [POSTS, "update", undefined],
        [POSTS, "create", "created"],
      ]);
    });

    it("answers each reader only events about collections they may read, and none they may not", async () => {
      const t = await boot(dialect);
      const post = await writesTo(t, POSTS).create(at(4), { title: "Post" });
      const secret = await writesTo(t, SECRET).create(at(3), {
        title: "Secret",
      });
      await writesTo(t, POSTS).update(at(2), post, { title: "Post 2" });
      await writesTo(t, SECRET).update(at(1), secret, { title: "Secret 2" });

      // Each reader asks for one row more than they may see, as the card asks: an event they
      // may not read must not fill it, or the card would say more exist.
      const editor = await card(as(EDITOR), 3);
      expect(editor.map(row => [row.entryId, row.event])).toEqual([
        [post, "saved"],
        [post, "created"],
      ]);
      const outsider = await card(as(OUTSIDER), 3);
      expect(outsider.map(row => [row.entryId, row.event])).toEqual([
        [secret, "saved"],
        [secret, "created"],
      ]);
      // The control: someone who may read both is answered all four.
      expect(await card(as(BOSS), 10)).toHaveLength(4);
    });
  }
);
