/**
 * Repeated saves as one row of Recent activity, on every dialect.
 *
 * What only a booted instance shows: the trail keeps every save while the feed
 * shows a run of them once, with its count; a page ends after a whole run and
 * the next starts at the next older row; a save the reader may not see does
 * not split a run for them; and the real write path lists `status` among a
 * save's changed fields only when the status changed, so a publish stays its
 * own row and a plain save of a live entry does not.
 *
 * @module services/dashboard/__tests__/recent-activity-runs.integration.test
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { readActivitySingles } from "../activity-singles";
import {
  allResources,
  someResources,
  type ReadableResources,
  type ReadCaller,
} from "../readable-resources";

// Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run on a reused database.
const NOTES = "rr_notes";
const SECRET = "rr_secret";
const HOME = "rr-home";

const ANA = { id: "rr-ana", name: "Ana", email: "ana@rr.test" };
const BEN = { id: "rr-ben", name: "Ben", email: "ben@rr.test" };
/** The one person `SECRET`'s rule lets read it. */
const BOSS = { id: "rr-boss", name: "Boss", email: "boss@rr.test" };

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
  action: string;
  collection: string;
  entryId: string | null;
  metadata: string | null;
}

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const t = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: NOTES,
        // Draft/Published, without versions: an edit writes the live row.
        status: true,
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
    ],
    singles: [
      defineSingle({
        slug: HOME,
        label: { singular: "Home" },
        access: { read: () => true, update: () => true },
        fields: [text({ name: "headline" })],
      }),
    ],
  });
  current = t;
  // Real accounts, so each write records its actor's name rather than an
  // identity already erased.
  for (const person of [ANA, BEN, BOSS]) {
    await t.adapter.insert("users", { ...person, is_active: true });
  }
  return t;
}

const trail = (t: TestNextly) => t.adapter.select<TrailRow>("activity_log");

/**
 * Runs `write`, then gives the one row it added to the trail the instant
 * `when`. The rows' order is then the cases' own: on MySQL, writes in the same
 * second would otherwise tie, and the tie is broken by a random id.
 */
async function written(
  t: TestNextly,
  when: Date,
  write: () => Promise<unknown>
): Promise<TrailRow> {
  const before = new Set((await trail(t)).map(row => row.id));
  await write();
  const added = (await trail(t)).filter(row => !before.has(row.id));
  expect(added).toHaveLength(1);
  await t.adapter.update(
    "activity_log",
    { created_at: when },
    { and: [{ column: "id", op: "=", value: added[0]!.id }] }
  );
  return added[0]!;
}

/** A save of a document, recorded as `person` made it. */
function logSave(
  t: TestNextly,
  person: { id: string },
  collection: string,
  entryId: string,
  changedFields: string[] = ["title", "updatedAt"]
) {
  return t.getService("activityLogService").logActivity({
    actorType: "user",
    userId: person.id,
    action: "update",
    collection,
    entryId,
    entryTitle: entryId,
    subjectKind: "collection",
    metadata: { changedFields },
  });
}

/** Creates an entry, leaving nothing of it in the trail. */
async function entry(t: TestNextly, collection: string): Promise<string> {
  const created = await t.nextly.create({ collection, data: { title: "x" } });
  await t.adapter.delete("activity_log", {
    and: [{ column: "collection", op: "=", value: collection }],
  });
  return String(created.item.id);
}

async function feed(
  t: TestNextly,
  caller: ReadCaller,
  options: {
    limit?: number;
    scope?: ReadableResources;
    before?: { createdAt: string; id: string };
  } = {}
) {
  return t.getService("activityLogService").getRecentActivity({
    limit: options.limit ?? 20,
    scope: options.scope ?? allResources(),
    caller,
    singles: await readActivitySingles(),
    ...(options.before ? { before: options.before } : {}),
  });
}

const as = (person: { id: string }): ReadCaller => ({
  user: { id: person.id, roles: [] },
});

describe.each(getConfiguredTestDialects())(
  "Recent activity's repeated saves (integration, %s)",
  dialect => {
    it("keeps five saves of a Single as five rows of the trail and shows them as one", async () => {
      const t = await boot(dialect);
      const singles = t.getService("singleEntryService") as unknown as {
        update: (
          slug: string,
          data: Record<string, unknown>,
          options: Record<string, unknown>
        ) => Promise<{ success: boolean }>;
      };
      for (let i = 0; i < 5; i++) {
        const saved = await singles.update(
          HOME,
          { headline: `Welcome ${i}` },
          { overrideAccess: true, actor: { type: "user", id: ANA.id } }
        );
        expect(saved.success).toBe(true);
      }

      expect(
        (await trail(t)).filter(row => row.collection === HOME)
      ).toHaveLength(5);
      const rows = (await feed(t, as(ANA))).activities.filter(
        row => row.collection === HOME
      );
      expect(rows.map(row => [row.count, row.countAtLeast])).toEqual([
        [5, false],
      ]);
    });

    it("ends a page after a whole run, and starts the next at the next older row", async () => {
      const t = await boot(dialect);
      const older = await entry(t, NOTES);
      const busy = await entry(t, NOTES);
      const olderSave = await written(t, at(30), () =>
        logSave(t, ANA, NOTES, older)
      );
      // Four saves: the run crosses the point where a page of one, read in rows
      // of the trail, would have ended.
      for (const minutes of [3, 2, 1, 0]) {
        await written(t, at(minutes), () => logSave(t, ANA, NOTES, busy));
      }

      const first = await feed(t, as(ANA), { limit: 1 });
      expect(first.activities.map(row => [row.entryId, row.count])).toEqual([
        [busy, 4],
      ]);
      expect(first.activities[0]?.firstCreatedAt).toBe(at(3).toISOString());
      expect(first.hasMore).toBe(true);
      expect(first.next).toBeDefined();

      const second = await feed(t, as(ANA), { limit: 1, before: first.next });
      // The next older row, and nothing of the run before it.
      expect(second.activities.map(row => [row.id, row.count])).toEqual([
        [olderSave.id, 1],
      ]);
      expect(second.hasMore).toBe(false);
    });

    it("does not split a run on a save its reader may not see, and does for one who may", async () => {
      const t = await boot(dialect);
      const note = await entry(t, NOTES);
      const secret = await entry(t, SECRET);
      await written(t, at(2), () => logSave(t, ANA, NOTES, note));
      await written(t, at(1), () => logSave(t, BEN, SECRET, secret));
      await written(t, at(0), () => logSave(t, ANA, NOTES, note));
      const scope = someResources([NOTES, SECRET]);

      const reader = await feed(t, as(ANA), { scope });
      expect(reader.activities.map(row => [row.entryId, row.count])).toEqual([
        [note, 2],
      ]);

      const boss = await feed(t, as(BOSS), { scope });
      expect(boss.activities.map(row => [row.entryId, row.count])).toEqual([
        [note, 1],
        [secret, 1],
        [note, 1],
      ]);
    });

    it("lists status only when it changed, so a plain save of a live entry joins and an unpublish does not", async () => {
      const t = await boot(dialect);
      const handler = t.getService("collectionsHandler") as unknown as {
        createEntry: (
          p: Record<string, unknown>,
          data: Record<string, unknown>
        ) => Promise<{ data: unknown }>;
        updateEntry: (
          p: Record<string, unknown>,
          data: Record<string, unknown>
        ) => Promise<unknown>;
      };
      const asAna = {
        collectionName: NOTES,
        overrideAccess: true,
        user: { id: ANA.id, email: ANA.email },
        actor: { type: "user", id: ANA.id },
      };
      let id = "";
      await written(t, at(5), async () => {
        const created = await handler.createEntry(asAna, {
          title: "live",
          status: "published",
        });
        id = (created.data as { id: string }).id;
      });
      const update = (minutes: number, data: Record<string, unknown>) =>
        written(t, at(minutes), () =>
          handler.updateEntry({ ...asAna, entryId: id }, data)
        );
      const firstSave = await update(4, { title: "one" });
      await update(3, { title: "two" });
      const unpublish = await update(2, { status: "draft" });
      await update(1, { title: "three" });

      // The write path's own record: a title-only save of the published entry
      // names no status, and the unpublish does.
      const fieldsOf = (row: TrailRow) =>
        (JSON.parse(row.metadata ?? "{}") as { changedFields?: string[] })
          .changedFields;
      expect(fieldsOf(firstSave)).toContain("title");
      expect(fieldsOf(firstSave)).not.toContain("status");
      expect(fieldsOf(unpublish)).toContain("status");

      const rows = (await feed(t, as(ANA))).activities.filter(
        row => row.entryId === id
      );
      expect(rows.map(row => [row.action, row.count])).toEqual([
        ["update", 1],
        ["update", 1],
        ["update", 2],
        ["create", 1],
      ]);
    });
  }
);
