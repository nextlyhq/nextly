/**
 * A trashed entry comes back as it was, and leaves the trash for good when it
 * is emptied or its thirty days pass.
 *
 * - A restore puts it back under its id, in every language, with its history
 *   read as one life, and a published entry comes back as a draft.
 * - Where another entry has taken its unique slug since, the restore writes
 *   nothing and names the slug; asked again with a new one, it restores.
 * - The site's created event is recorded, marked as a restore; a plain
 *   create's is not marked.
 * - Emptying removes it for good and ends its history; the daily clean-up
 *   removes what is past its purge date, and nothing younger.
 * - The preset Editor restores; the preset Author is refused, as deleting is
 *   refused to it.
 *
 * @module domains/trash/__tests__/restore-and-empty.integration.test
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { defineCollection, text } from "../../../config";
import { getDialectTables } from "../../../database/index";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { CONTENT_EVENTS_TABLE } from "../../../schemas/content-events";
import { TRASH_TABLE } from "../../../schemas/trash";
import { pruneContentEventsSafely } from "../../content-events/prune";
import type { WebhookEvent } from "../../webhooks/types";
import { purgeExpiredTrash } from "../trash-records";

perLanguageStorageSuite();

/** A restore's result, unwrapped from its mutation envelope. */
const restoreOf = async (
  t: TestNextly,
  args: Parameters<TestNextly["nextly"]["trash"]["restore"]>[0]
) => (await t.nextly.trash.restore(args)).item;

/** An emptying's result, unwrapped from its mutation envelope. */
const emptyOf = async (
  t: TestNextly,
  args?: Parameters<TestNextly["nextly"]["trash"]["empty"]>[0]
) => (await t.nextly.trash.empty(args)).item;

const POSTS = "trashback_posts";
const LANGUAGES = { locales: ["en", "de"], defaultLocale: "en" };
const DAY_MS = 24 * 60 * 60 * 1000;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    localization: LANGUAGES,
    // The preset roles, as a real boot seeds them.
    seedPublic: true,
    collections: [
      defineCollection({
        slug: POSTS,
        localized: true,
        status: true,
        grants: { presets: ["editor", "author"] },
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "slug", unique: true }),
        ],
      }),
    ],
  });
  return current;
}

/** A post in English and German; its id. */
async function post(
  t: TestNextly,
  slug: string,
  status: "draft" | "published" = "draft"
): Promise<string> {
  const made = await t.nextly.create({
    collection: POSTS,
    data: { title: "Hello", slug, status },
  });
  const id = String(made.item.id);
  await t.nextly.update({
    collection: POSTS,
    id,
    locale: "de",
    data: { title: "Hallo", _overwrite: true },
  } as never);
  return id;
}

async function stored(t: TestNextly, id: string, locale = "en") {
  return t.nextly
    .findByID({ collection: POSTS, id, locale, draft: true } as never)
    .then(found => found as unknown as Record<string, unknown>)
    .catch(() => undefined);
}

async function trashed(t: TestNextly, id: string): Promise<number> {
  const rows = await t.adapter.select(TRASH_TABLE, {
    where: { and: [{ column: "itemId", op: "=", value: id }] },
  });
  return rows.length;
}

/** The kinds of the entry's history events, oldest first, as history reads it. */
async function historyKinds(t: TestNextly, id: string): Promise<string[]> {
  const page = await t.nextly.contentEvents.list({
    subject: { kind: "collection", slug: POSTS, id },
    limit: 100,
  });
  return page.items.map(event => event.kind).reverse();
}

interface EventRow {
  type: string;
  payload: unknown;
}

/** The recorded `entry.created` events of `id`. */
async function createdEvents(
  t: TestNextly,
  id: string
): Promise<WebhookEvent[]> {
  const rows = await t.adapter.select<EventRow>("nextly_events");
  return rows
    .map(
      row =>
        (typeof row.payload === "string"
          ? JSON.parse(row.payload)
          : row.payload) as WebhookEvent
    )
    .filter(
      event => event.type === "entry.created" && event.resource.id === id
    );
}

interface StoredEvent {
  endedBy: string | null;
  endsSubject: boolean | number;
}

/** The entry's history events that a deletion's stamp ends. */
async function endedEvents(t: TestNextly, id: string): Promise<StoredEvent[]> {
  const rows = await t.adapter.select<StoredEvent>(CONTENT_EVENTS_TABLE, {
    columns: ["endedBy", "endsSubject"],
    where: { and: [{ column: "subjectId", op: "=", value: id }] },
  });
  return rows.filter(row => row.endedBy !== null);
}

/** A user holding the preset role `slug`; their id. */
async function withPreset(t: TestNextly, slug: string): Promise<string> {
  const tables = getDialectTables(t.adapter.dialect);
  const id = `trashback-${slug}-${randomUUID().slice(0, 8)}`;
  const db = t.adapter.getDrizzle() as unknown as {
    insert(table: unknown): { values(row: unknown): Promise<unknown> };
  };
  const now = new Date();
  await db.insert(tables.users).values({
    id,
    email: `${id}@example.test`,
    name: id,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const [role] = await t.adapter.select<{ id: string }>("roles", {
    where: { and: [{ column: "slug", op: "=", value: slug }] },
  });
  await db.insert(tables.userRoles).values({
    id: randomUUID(),
    userId: id,
    roleId: role.id,
    createdAt: now,
  });
  return id;
}

/** The status a refused call answered with, or "done". */
async function outcome(call: () => Promise<unknown>): Promise<number | string> {
  try {
    await call();
  } catch (error) {
    if (NextlyError.is(error)) return error.statusCode;
    throw error;
  }
  return "done";
}

describe.each(getConfiguredTestDialects())("on %s", dialect => {
  it("a restore brings the entry back under its id, in every language, with its history whole", async () => {
    const t = await boot(dialect);
    const id = await post(t, "hello");
    await t.nextly.delete({ collection: POSTS, id });
    expect(await stored(t, id)).toBeUndefined();

    const result = await restoreOf(t, { id });

    expect(result).toEqual({ restored: true, collection: POSTS, id });
    expect(await stored(t, id)).toMatchObject({
      id,
      title: "Hello",
      slug: "hello",
    });
    expect(await stored(t, id, "de")).toMatchObject({ title: "Hallo" });
    expect(await trashed(t, id)).toBe(0);
    // One life: the events before the delete, the delete, and the restore.
    const kinds = await historyKinds(t, id);
    expect(kinds[0]).toBe("created");
    expect(kinds.slice(-2)).toEqual(["deleted", "restored-from-trash"]);
  });

  it("a restore re-opens only its own entry's life; another deleted entry's stays ended", async () => {
    const t = await boot(dialect);
    const restored = await post(t, "one-life");
    const other = await post(t, "stays-gone");
    await t.nextly.delete({ collection: POSTS, id: restored });
    await t.nextly.delete({ collection: POSTS, id: other });

    await restoreOf(t, { id: restored });

    // Every event of the restored entry is in its current life again.
    expect(await endedEvents(t, restored)).toEqual([]);
    // The other's events are all still stamped by its deletion.
    const stillEnded = await endedEvents(t, other);
    expect(stillEnded.length).toBeGreaterThan(1);
    expect(new Set(stillEnded.map(e => e.endedBy)).size).toBe(1);
    expect(stillEnded.some(e => e.endsSubject)).toBe(true);
  });

  it("a published entry comes back as a draft", async () => {
    const t = await boot(dialect);
    const id = await post(t, "live", "published");
    expect(await stored(t, id)).toMatchObject({ status: "published" });
    await t.nextly.delete({ collection: POSTS, id });

    await restoreOf(t, { id });

    expect(await stored(t, id)).toMatchObject({ status: "draft" });
  });

  it("a slug taken since is asked for again, writing nothing, and a new one restores", async () => {
    const t = await boot(dialect);
    const first = await post(t, "taken");
    await t.nextly.delete({ collection: POSTS, id: first });
    await post(t, "taken");

    const refused = await restoreOf(t, { id: first });

    expect(refused).toEqual({
      restored: false,
      // The collection keeps its fields per language, the slug included.
      conflicts: [{ field: "slug", value: "taken", locale: "en" }],
    });
    expect(await stored(t, first)).toBeUndefined();
    expect(await trashed(t, first)).toBe(1);

    const again = await restoreOf(t, {
      id: first,
      values: { slug: "taken-again" },
    });

    expect(again).toMatchObject({ restored: true, id: first });
    expect(await stored(t, first)).toMatchObject({ slug: "taken-again" });
    // The site's created event names the slug the entry holds now.
    const restored = (await createdEvents(t, first)).find(
      e => e.restoredFrom === "trash"
    );
    expect(restored?.data).toMatchObject({ slug: "taken-again" });
  });

  it("records the created event marked as a restore, and a plain create's unmarked", async () => {
    const t = await boot(dialect);
    const id = await post(t, "events");
    const [plain] = await createdEvents(t, id);
    expect(plain).toBeDefined();
    expect(plain).not.toHaveProperty("restoredFrom");
    await t.nextly.delete({ collection: POSTS, id });

    await restoreOf(t, { id });

    const events = await createdEvents(t, id);
    expect(events).toHaveLength(2);
    expect(events.filter(e => e.restoredFrom === "trash")).toHaveLength(1);
    const restored = events.find(e => e.restoredFrom === "trash");
    expect(restored?.data).toMatchObject({ id, title: "Hello" });
    // Every language and the shared fields came back.
    expect(restored?.shared).toBe(true);
  });

  it("emptying removes the entry for good and ends its history", async () => {
    const t = await boot(dialect);
    const id = await post(t, "gone");
    await t.nextly.delete({ collection: POSTS, id });

    const { removed } = await emptyOf(t, { collection: POSTS });

    expect(removed.map(item => item.itemId)).toEqual([id]);
    expect(await trashed(t, id)).toBe(0);
    expect(await outcome(() => restoreOf(t, { id }))).toBe(404);
    // Its history ended with its deletion, and nothing re-opened it.
    expect((await historyKinds(t, id)).slice(-1)).toEqual(["deleted"]);
  });

  it("the daily clean-up removes what is past its thirty days, and nothing younger", async () => {
    const t = await boot(dialect);
    const id = await post(t, "aging");
    await t.nextly.delete({ collection: POSTS, id });
    const now = Date.now();

    expect(
      await purgeExpiredTrash(t.adapter, new Date(now + 29 * DAY_MS))
    ).toEqual([]);
    expect(await trashed(t, id)).toBe(1);

    const purged = await purgeExpiredTrash(
      t.adapter,
      new Date(now + 31 * DAY_MS)
    );

    expect(purged.map(item => item.itemId)).toEqual([id]);
    expect(await trashed(t, id)).toBe(0);
  });

  it("a trashed entry's history outlives a shorter activity window while it is in the trash, and not after", async () => {
    const t = await boot(dialect);
    const id = await post(t, "window");
    await t.nextly.delete({ collection: POSTS, id });
    const now = Date.now();
    const prune = (at: number) =>
      pruneContentEventsSafely(
        { db: t.adapter, now: () => new Date(at) },
        7 * DAY_MS,
        10
      );

    // Day 8 on a 7-day window: in the trash, so kept.
    await prune(now + 8 * DAY_MS);
    expect((await endedEvents(t, id)).length).toBeGreaterThan(0);

    // Purged at day 31; the next run removes its history.
    await purgeExpiredTrash(t.adapter, new Date(now + 31 * DAY_MS));
    await prune(now + 31 * DAY_MS);
    expect(await endedEvents(t, id)).toEqual([]);
  });

  it("the preset Editor restores and empties; the preset Author is refused both", async () => {
    const t = await boot(dialect);
    const editor = await withPreset(t, "editor");
    const author = await withPreset(t, "author");
    const id = await post(t, "people");
    await t.nextly.delete({ collection: POSTS, id });

    expect(
      await outcome(() =>
        restoreOf(t, {
          id,
          user: { id: author },
          overrideAccess: false,
        })
      )
    ).toBe(403);
    expect(
      await outcome(() =>
        emptyOf(t, {
          collection: POSTS,
          user: { id: author },
          overrideAccess: false,
        })
      )
    ).toBe(403);
    expect(await trashed(t, id)).toBe(1);

    expect(
      await restoreOf(t, {
        id,
        user: { id: editor },
        overrideAccess: false,
      })
    ).toMatchObject({ restored: true, id });

    // Deleted again: the Editor empties it, by the permission the presets
    // grant, as `empty-<collection>`.
    await t.nextly.delete({ collection: POSTS, id });
    const { removed } = await emptyOf(t, {
      collection: POSTS,
      user: { id: editor },
      overrideAccess: false,
    });
    expect(removed.map(item => item.itemId)).toEqual([id]);
    expect(await trashed(t, id)).toBe(0);
  });
});
