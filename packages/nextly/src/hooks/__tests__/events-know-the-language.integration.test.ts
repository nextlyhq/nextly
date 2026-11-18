/**
 * Events name the languages a change involved and whether it moved the shared
 * part (the fields kept the same in every language), as its hooks are told:
 * the outbox envelope a webhook receives, the activity trail's row, and the
 * in-process `collection.<slug>.*` event.
 *
 * Each case makes one change as a signed-in person, so the trail records it,
 * and reads back only what that change recorded.
 *
 * @module hooks/__tests__/events-know-the-language.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../config";
import { getEventBus, type EventEnvelope } from "../../events";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";

const POSTS = "ekl_posts";

const ACTOR = {
  id: "ekl-actor",
  name: "Ada Lovelace",
  email: "ada@example.test",
};

/** An outbox row as read back. */
interface EventRow {
  id: string;
  type: string;
  payload: unknown;
}

/** An `activity_log` row as read back (Drizzle camelCases the columns). */
interface ActivityRow {
  id: string;
  action: string;
  locale: string | null;
  metadata: unknown;
}

/** What an outbox envelope says about the change's languages. */
interface Envelope {
  type: string;
  resource: { locale?: string };
  changedFields: string[];
  locales?: unknown;
  shared?: unknown;
}

let current: TestNextly | undefined;
/** The bus listeners a case added, taken off after it. */
const listening: [string, (event: EventEnvelope) => void][] = [];

afterEach(async () => {
  for (const [name, handler] of listening) getEventBus().off(name, handler);
  listening.length = 0;
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        localized: true,
        status: true,
        fields: [
          text({ name: "title" }),
          // Shared: one value for every language.
          text({ name: "code", localized: false }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  // A real account, so the trail records the person's writes.
  await current.adapter.insert("users", {
    id: ACTOR.id,
    name: ACTOR.name,
    email: ACTOR.email,
    is_active: true,
  });
  return current;
}

/** The write's caller: the person, trusted past access checks. */
const asActor = {
  overrideAccess: true as const,
  user: { id: ACTOR.id, email: ACTOR.email },
  actor: { type: "user" as const, id: ACTOR.id },
};

const handlerOf = (t: TestNextly) =>
  t.getService("collectionsHandler") as unknown as {
    createEntry(
      params: Record<string, unknown>,
      body: Record<string, unknown>
    ): Promise<{ success: boolean; data?: unknown }>;
    updateEntry(
      params: Record<string, unknown>,
      body: Record<string, unknown>
    ): Promise<{ success: boolean }>;
    deleteEntry(params: Record<string, unknown>): Promise<{ success: boolean }>;
    getEntryService(): {
      publishAllLocales(
        params: Record<string, unknown>
      ): Promise<{ success: boolean }>;
    };
  };

/** A stored JSON value as an object, from text or a decoded column. */
const parsed = (value: unknown): Record<string, unknown> =>
  (typeof value === "string" ? JSON.parse(value) : (value ?? {})) as Record<
    string,
    unknown
  >;

/** The outbox events and trail rows written since `mark` was taken. */
async function recordedSince(
  t: TestNextly,
  mark: { events: Set<string>; activity: Set<string> }
): Promise<{ events: Envelope[]; activity: ActivityRow[] }> {
  const events = (await t.adapter.select<EventRow>("nextly_events"))
    .filter(row => !mark.events.has(String(row.id)))
    .map(row => parsed(row.payload) as unknown as Envelope);
  const activity = (await t.adapter.select<ActivityRow>("activity_log")).filter(
    row => !mark.activity.has(String(row.id))
  );
  return { events, activity };
}

/** What has been recorded so far, to tell a case's own records apart. */
async function markOf(
  t: TestNextly
): Promise<{ events: Set<string>; activity: Set<string> }> {
  const events = await t.adapter.select<EventRow>("nextly_events");
  const activity = await t.adapter.select<ActivityRow>("activity_log");
  return {
    events: new Set(events.map(row => String(row.id))),
    activity: new Set(activity.map(row => String(row.id))),
  };
}

/** An entry in English and in Spanish, each in `status`. */
async function inBoth(
  t: TestNextly,
  status: "draft" | "published"
): Promise<string> {
  const h = handlerOf(t);
  const created = await h.createEntry(
    { collectionName: POSTS, locale: "en", ...asActor },
    { title: "Harbour", code: "a", status }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  const id = String((created.data as { id: unknown }).id);
  const translated = await h.updateEntry(
    { collectionName: POSTS, entryId: id, locale: "es", ...asActor },
    { title: "Puerto", status, _overwrite: true }
  );
  expect(translated.success, JSON.stringify(translated)).toBe(true);
  return id;
}

describe.each(getConfiguredTestDialects())(
  "events know the language (integration, %s)",
  dialect => {
    it("names a translated update's language, and that it leaves the shared part", async () => {
      const t = await boot(dialect);
      const id = await inBoth(t, "published");
      const mark = await markOf(t);
      const saved = await handlerOf(t).updateEntry(
        { collectionName: POSTS, entryId: id, locale: "es", ...asActor },
        { title: "Puerto 2", _overwrite: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);

      const { events, activity } = await recordedSince(t, mark);
      const updated = events.find(e => e.type === "entry.updated");
      expect(updated, JSON.stringify(events)).toBeDefined();
      expect(updated).toMatchObject({
        resource: { locale: "es" },
        locales: ["es"],
        shared: false,
      });
      expect(updated?.changedFields).toContain("title");
      expect(updated?.changedFields).not.toContain("code");

      expect(activity).toHaveLength(1);
      expect(activity[0]).toMatchObject({ action: "update", locale: "es" });
      expect(parsed(activity[0].metadata)).toMatchObject({
        locales: ["es"],
        shared: false,
        changedFields: expect.arrayContaining(["title"]),
      });
    }, 90_000);

    it("names every language a publish of every language puts live, and the shared part", async () => {
      const t = await boot(dialect);
      const id = await inBoth(t, "draft");
      const mark = await markOf(t);
      const published = await handlerOf(t)
        .getEntryService()
        .publishAllLocales({
          collectionName: POSTS,
          entryId: id,
          data: { _overwrite: true },
          ...asActor,
        });
      expect(published.success, JSON.stringify(published)).toBe(true);

      const { events, activity } = await recordedSince(t, mark);
      // The event for the whole entry names no one language, and every one.
      const base = events.find(
        e => e.type === "entry.updated" && e.resource.locale === undefined
      );
      expect(base, JSON.stringify(events)).toBeDefined();
      expect(base).toMatchObject({ locales: ["en", "es"], shared: true });
      // Each language's own events name that language alone.
      const perLanguage = events.filter(e => e.resource.locale !== undefined);
      expect(
        [...new Set(perLanguage.map(e => e.resource.locale))].sort()
      ).toEqual(["en", "es"]);
      for (const event of perLanguage) {
        expect(event.locales, event.type).toEqual([event.resource.locale]);
      }

      const whole = activity.find(row => row.locale === null);
      expect(whole, JSON.stringify(activity)).toBeDefined();
      expect(parsed(whole?.metadata)).toMatchObject({
        locales: ["en", "es"],
        shared: true,
      });
      for (const row of activity.filter(r => r.locale !== null)) {
        expect(parsed(row.metadata).locales, String(row.locale)).toEqual([
          row.locale,
        ]);
      }
    }, 90_000);

    it("names every language of a deleted entry, and the shared part", async () => {
      const t = await boot(dialect);
      const id = await inBoth(t, "published");
      const mark = await markOf(t);
      const deleted = await handlerOf(t).deleteEntry({
        collectionName: POSTS,
        entryId: id,
        ...asActor,
      });
      expect(deleted.success, JSON.stringify(deleted)).toBe(true);

      const { events, activity } = await recordedSince(t, mark);
      const gone = events.find(e => e.type === "entry.deleted");
      expect(gone, JSON.stringify(events)).toBeDefined();
      expect(gone).toMatchObject({ locales: ["en", "es"], shared: true });

      const row = activity.find(r => r.action === "delete");
      expect(row, JSON.stringify(activity)).toBeDefined();
      expect(parsed(row?.metadata)).toMatchObject({
        locales: ["en", "es"],
        shared: true,
      });
    }, 90_000);

    it("tells an in-process listener the language and the fields changed", async () => {
      const t = await boot(dialect);
      const id = await inBoth(t, "published");
      const heard: Record<string, unknown>[] = [];
      for (const action of ["updated", "deleted"]) {
        const name = `collection.${POSTS}.${action}`;
        const handler = (event: EventEnvelope) => {
          heard.push({ action, ...parsed(event.payload) });
        };
        getEventBus().on(name, handler);
        listening.push([name, handler]);
      }

      const saved = await handlerOf(t).updateEntry(
        { collectionName: POSTS, entryId: id, locale: "es", ...asActor },
        { title: "Puerto 2", _overwrite: true }
      );
      expect(saved.success, JSON.stringify(saved)).toBe(true);
      const deleted = await handlerOf(t).deleteEntry({
        collectionName: POSTS,
        entryId: id,
        ...asActor,
      });
      expect(deleted.success, JSON.stringify(deleted)).toBe(true);

      const updated = heard.find(e => e.action === "updated");
      expect(updated).toMatchObject({ locale: "es", locales: ["es"] });
      expect(updated?.changedFields).toContain("title");
      expect(updated?.changedFields).not.toContain("code");
      const gone = heard.find(e => e.action === "deleted");
      expect(gone?.locale).toBeUndefined();
      expect(gone).toMatchObject({ locales: ["en", "es"] });
    }, 90_000);
  }
);
