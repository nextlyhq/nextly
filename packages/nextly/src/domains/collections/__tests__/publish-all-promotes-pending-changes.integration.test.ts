// Publishing every language of a collection entry puts each language's
// pending change live, judged as a publish of every language of a Single is,
// and tells each language what a publish of that language alone tells it.
//
// The plausible broken implementations flip every language's status and
// leave the pending changes pending (the publish then reports success while
// the content an author held stays unpublished), merge a change that is
// behind live over newer shared values, or tell a live language nothing.

import { afterEach, describe, expect, it } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { WebhookEvent } from "../../webhooks/types";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const POSTS = "pendingposts";

async function boot(dialect: TestDialect): Promise<CollectionEntryService> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: POSTS,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title", localized: true }),
          // Shared by every language.
          text({ name: "tagline", localized: false }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return (
    current.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

/** A boot with `collection` alone, in the same two languages. */
async function bootWith(
  dialect: TestDialect,
  collection: ReturnType<typeof defineCollection>,
  fieldGroups: ReturnType<typeof defineFieldGroup>[] = []
): Promise<CollectionEntryService> {
  current = await createTestNextly({
    dialect,
    collections: [collection],
    fieldGroups,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return (
    current.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

const at = (entryId: string, locale: string, collectionName = POSTS) => ({
  collectionName,
  entryId,
  overrideAccess: true,
  locale,
});

/** One field of an entry as a trusted read of `locale` returns it: live. */
async function fieldIn(
  entries: CollectionEntryService,
  target: { collectionName: string; id: string; locale: string },
  field: string
): Promise<unknown> {
  const read = await entries.getEntry(
    at(target.id, target.locale, target.collectionName)
  );
  return (read.data as Record<string, unknown> | null)?.[field];
}

/** An entry's stored translation rows for `locale`, as the table holds them. */
async function translationRows(
  id: string,
  locale: string
): Promise<Record<string, unknown>[]> {
  return current!.adapter.select<Record<string, unknown>>(
    `dc_${POSTS}_locales`,
    {
      where: {
        and: [
          { column: "_parent", op: "=", value: id },
          { column: "_locale", op: "=", value: locale },
        ],
      },
    }
  );
}

/** A `nextly_content_events` row: one event in a document's history. */
interface HistoryRow {
  id: string;
  subjectId: string;
  kind: string;
  fromState: string | null;
  toState: string | null;
}

async function historyIds(): Promise<Set<string>> {
  const rows = await current!.adapter.select<HistoryRow>(
    "nextly_content_events"
  );
  return new Set(rows.map(row => row.id));
}

/** One entry's publish events in its history since `before`, with the languages each names. */
async function publishesSince(
  before: ReadonlySet<string>,
  entryId: string
): Promise<{ from: string | null; to: string | null; locales: string[] }[]> {
  const events = (
    await current!.adapter.select<HistoryRow>("nextly_content_events")
  ).filter(
    row =>
      !before.has(row.id) &&
      row.subjectId === entryId &&
      row.kind === "published"
  );
  const parts = await current!.adapter.select<{
    eventId: string;
    part: string;
  }>("nextly_content_event_parts");
  return events.map(event => ({
    from: event.fromState,
    to: event.toState,
    locales: parts
      .filter(part => part.eventId === event.id)
      .map(part => part.part)
      .sort(),
  }));
}

/** An entry live in English and Spanish, with English's change held. */
async function liveWithEnglishPending(
  entries: CollectionEntryService
): Promise<string> {
  const created = await entries.createEntry(
    { collectionName: POSTS, overrideAccess: true, locale: "en" },
    { title: "Hello", tagline: "Shared", status: "published" }
  );
  const id = (created.data as { id: string }).id;
  const es = await entries.updateEntry(at(id, "es"), {
    title: "Hola",
    status: "published",
  });
  expect(es.success, JSON.stringify(es)).toBe(true);
  const held = await entries.updateEntry(at(id, "en"), {
    title: "Hello again",
  });
  expect(held.success, JSON.stringify(held)).toBe(true);
  return id;
}

async function titleIn(
  entries: CollectionEntryService,
  id: string,
  locale: string
): Promise<unknown> {
  const read = await entries.getEntry(at(id, locale));
  return (read.data as { title?: unknown } | null)?.title;
}

async function pendingLocales(id: string): Promise<string[]> {
  const rows = await current!.adapter.select<{ locale: string | null }>(
    "nextly_versions",
    {
      where: {
        and: [
          { column: "entryId", op: "=", value: id },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NULL" },
          { column: "status", op: "=", value: "draft" },
        ],
      },
    }
  );
  return rows.map(row => row.locale ?? "(none)").sort();
}

/** A `nextly_events` row as read back. */
interface EventRow {
  id: string;
  type: string;
  payload: unknown;
}

async function eventIds(): Promise<Set<string>> {
  const rows = await current!.adapter.select<EventRow>("nextly_events");
  return new Set(rows.map(row => row.id));
}

/** One entry's language-tagged events since `before`, as a subscriber diffs them. */
async function taggedSince(
  before: ReadonlySet<string>,
  entryId: string
): Promise<
  { type: string; locale: string; data: unknown; previous: unknown }[]
> {
  const rows = await current!.adapter.select<EventRow>("nextly_events");
  return rows
    .filter(row => !before.has(row.id))
    .map(
      row =>
        (typeof row.payload === "string"
          ? JSON.parse(row.payload)
          : row.payload) as WebhookEvent
    )
    .filter(
      event =>
        event.resource.kind === "entry" &&
        event.resource.id === entryId &&
        event.resource.locale !== undefined
    )
    .map(event => ({
      type: event.type,
      locale: event.resource.locale as string,
      data: event.data.title,
      previous: event.previous?.title,
    }))
    .sort((a, b) =>
      `${a.locale}:${a.type}`.localeCompare(`${b.locale}:${b.type}`)
    );
}

describe.each(getConfiguredTestDialects())(
  "publishing every language of a collection entry with pending changes (integration, %s)",
  dialect => {
    it("puts each language's pending change live, and says so language by language", async () => {
      const entries = await boot(dialect);
      const id = await liveWithEnglishPending(entries);
      expect(await titleIn(entries, id, "en")).toBe("Hello");
      expect(await pendingLocales(id)).toEqual(["en"]);

      const published = await entries.publishAllLocales({
        collectionName: POSTS,
        entryId: id,
        overrideAccess: true,
      });
      expect(published.success, JSON.stringify(published)).toBe(true);
      expect(
        (published.data as { languages?: unknown } | null)?.languages
      ).toEqual([
        { locale: "en", outcome: "goes-live-with-pending-change" },
        { locale: "es", outcome: "stays-published" },
      ]);
      expect(await titleIn(entries, id, "en")).toBe("Hello again");
      expect(await titleIn(entries, id, "es")).toBe("Hola");
      expect(await pendingLocales(id)).toEqual([]);
    });

    it("refuses a pending change behind live, naming the shared field, and puts nothing live", async () => {
      const entries = await boot(dialect);
      const created = await entries.createEntry(
        { collectionName: POSTS, overrideAccess: true, locale: "en" },
        { title: "Hello", tagline: "Old", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      await entries.updateEntry(at(id, "es"), {
        title: "Hola",
        status: "published",
      });
      // Spanish's pending change begins from the live shared value...
      await entries.updateEntry(at(id, "es"), { title: "Hola otra vez" });
      // ...and English then publishes a new one.
      const newer = await entries.updateEntry(at(id, "en"), {
        tagline: "New",
        status: "published",
      });
      expect(newer.success, JSON.stringify(newer)).toBe(true);

      const refused = await entries.publishAllLocales({
        collectionName: POSTS,
        entryId: id,
        overrideAccess: true,
      });
      expect(refused.success).toBe(false);
      expect(refused.statusCode).toBe(409);
      expect((refused as { publicData?: unknown }).publicData).toMatchObject({
        reason: "shared-fields-out-of-date",
        fields: ["tagline"],
      });
      expect(await titleIn(entries, id, "es")).toBe("Hola");
      expect(await pendingLocales(id)).toEqual(["es"]);
    });

    it("tells each language what a publish of that language alone tells it", async () => {
      const entries = await boot(dialect);
      const alone = await liveWithEnglishPending(entries);
      const every = await liveWithEnglishPending(entries);
      const before = await eventIds();

      const one = await entries.updateEntry(at(alone, "en"), {
        status: "published",
      });
      expect(one.success, JSON.stringify(one)).toBe(true);
      const all = await entries.publishAllLocales({
        collectionName: POSTS,
        entryId: every,
        overrideAccess: true,
      });
      expect(all.success, JSON.stringify(all)).toBe(true);

      const told = await taggedSince(before, alone);
      expect(told).toContainEqual(
        expect.objectContaining({
          locale: "en",
          data: "Hello again",
          previous: "Hello",
        })
      );
      expect(await taggedSince(before, every)).toEqual(told);
    });
  }
);

const GUARDED = "guardedpending";
const HEROES = "heropending";
const PUBLISHER = "publisher";

describe.each(getConfiguredTestDialects())(
  "what publishing every language owes each pending change it promotes (integration, %s)",
  dialect => {
    it("refuses a pending change editing a field the publisher may not write, as a publish of that language refuses it", async () => {
      const entries = await bootWith(
        dialect,
        defineCollection({
          slug: GUARDED,
          localized: true,
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title", localized: true }),
            // No caller judged by the field rules may write it; a trusted
            // save may.
            text({ name: "note", access: { update: () => false } }),
          ],
        })
      );
      await userWhoMay(current!, PUBLISHER, "publish", [GUARDED]);
      const created = await entries.createEntry(
        { collectionName: GUARDED, overrideAccess: true, locale: "en" },
        { title: "Hello", note: "Live", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const held = await entries.updateEntry(at(id, "en", GUARDED), {
        note: "Held",
      });
      expect(held.success, JSON.stringify(held)).toBe(true);
      // POPULATION CONTROL: the edit is pending, not live.
      expect(await pendingLocales(id)).toEqual(["en"]);
      const note = { collectionName: GUARDED, id, locale: "en" };
      expect(await fieldIn(entries, note, "note")).toBe("Live");

      const publisher = { overrideAccess: false, user: { id: PUBLISHER } };
      const one = await entries.updateEntry(
        { collectionName: GUARDED, entryId: id, locale: "en", ...publisher },
        { status: "published" }
      );
      const every = await entries.publishAllLocales({
        collectionName: GUARDED,
        entryId: id,
        ...publisher,
      });

      // The publish of English alone refuses on the field, naming it...
      expect(one.success).toBe(false);
      const oneRefusal = {
        statusCode: one.statusCode,
        publicData: (one as { publicData?: unknown }).publicData,
      };
      expect(oneRefusal.publicData).toMatchObject({
        errors: [{ path: "note", code: "FORBIDDEN" }],
      });
      // ...and publishing every language refuses it exactly so.
      expect(every.success).toBe(false);
      expect({
        statusCode: every.statusCode,
        publicData: (every as { publicData?: unknown }).publicData,
      }).toEqual(oneRefusal);
      // Nothing went live, and the change is kept for someone who may write it.
      expect(await fieldIn(entries, note, "note")).toBe("Live");
      expect(await pendingLocales(id)).toEqual(["en"]);
    });

    it("records a promoted live language moving from draft, as a publish of that language alone records it", async () => {
      const entries = await boot(dialect);
      const alone = await liveWithEnglishPending(entries);
      const every = await liveWithEnglishPending(entries);
      const before = await historyIds();

      const one = await entries.updateEntry(at(alone, "en"), {
        status: "published",
      });
      expect(one.success, JSON.stringify(one)).toBe(true);
      const all = await entries.publishAllLocales({
        collectionName: POSTS,
        entryId: every,
        overrideAccess: true,
      });
      expect(all.success, JSON.stringify(all)).toBe(true);

      // English was published before and after; the move is its change's.
      const recorded = await publishesSince(before, alone);
      expect(recorded).toEqual([
        { from: "draft", to: "published", locales: ["en"] },
      ]);
      expect(await publishesSince(before, every)).toEqual(recorded);
    });

    it("puts a pending change to a field group live", async () => {
      const entries = await bootWith(
        dialect,
        defineCollection({
          slug: HEROES,
          localized: true,
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title", localized: true }),
            fieldGroup({ name: "hero", component: "pendinghero" }),
          ],
        }),
        [
          defineFieldGroup({
            slug: "pendinghero",
            fields: [text({ name: "heading" })],
          }),
        ]
      );
      const created = await entries.createEntry(
        { collectionName: HEROES, overrideAccess: true, locale: "en" },
        { title: "Hello", hero: { heading: "Live" }, status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const held = await entries.updateEntry(at(id, "en", HEROES), {
        hero: { heading: "Held" },
      });
      expect(held.success, JSON.stringify(held)).toBe(true);
      const heading = async () =>
        (
          (await fieldIn(
            entries,
            { collectionName: HEROES, id, locale: "en" },
            "hero"
          )) as { heading?: unknown } | undefined
        )?.heading;
      // POPULATION CONTROL: the component edit is pending, not live.
      expect(await pendingLocales(id)).toEqual(["en"]);
      expect(await heading()).toBe("Live");

      const published = await entries.publishAllLocales({
        collectionName: HEROES,
        entryId: id,
        overrideAccess: true,
      });
      expect(published.success, JSON.stringify(published)).toBe(true);
      expect(await heading()).toBe("Held");
      expect(await pendingLocales(id)).toEqual([]);
    });

    it("writes a translation row for a promoted change only where it holds translated values", async () => {
      const entries = await boot(dialect);
      const englishOnly = async (): Promise<string> => {
        const created = await entries.createEntry(
          { collectionName: POSTS, overrideAccess: true, locale: "en" },
          { title: "Hello", tagline: "Shared", status: "published" }
        );
        return (created.data as { id: string }).id;
      };
      const blank = await englishOnly();
      const translated = await englishOnly();
      // Spanish has no translation on either. One change edits only what
      // every language shares; the other translates the title.
      const sharedOnly = await entries.updateEntry(at(blank, "es"), {
        tagline: "From Spanish",
      });
      expect(sharedOnly.success, JSON.stringify(sharedOnly)).toBe(true);
      const withTitle = await entries.updateEntry(at(translated, "es"), {
        title: "Hola",
      });
      expect(withTitle.success, JSON.stringify(withTitle)).toBe(true);
      // POPULATION CONTROL: each is a change held for a language with no row.
      for (const id of [blank, translated]) {
        expect(await pendingLocales(id)).toEqual(["es"]);
        expect(await translationRows(id, "es")).toEqual([]);
      }

      for (const id of [blank, translated]) {
        const published = await entries.publishAllLocales({
          collectionName: POSTS,
          entryId: id,
          overrideAccess: true,
        });
        expect(published.success, JSON.stringify(published)).toBe(true);
        expect(await pendingLocales(id)).toEqual([]);
      }

      // The shared edit went live, and no Spanish translation was invented
      // for it: Spanish still shows the language it falls back to.
      expect(
        await fieldIn(
          entries,
          { collectionName: POSTS, id: blank, locale: "en" },
          "tagline"
        )
      ).toBe("From Spanish");
      expect(await translationRows(blank, "es")).toEqual([]);
      // The translated one went live as Spanish's own row.
      const rows = await translationRows(translated, "es");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ title: "Hola", _status: "published" });
      expect(await titleIn(entries, translated, "es")).toBe("Hola");
    });
  }
);
