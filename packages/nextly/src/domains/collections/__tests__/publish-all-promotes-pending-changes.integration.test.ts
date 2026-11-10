// Publishing every language of a collection entry puts each language's
// pending change live, judged as a publish of every language of a Single is,
// and tells each language what a publish of that language alone tells it.
//
// The plausible broken implementations flip every language's status and
// leave the pending changes pending (the publish then reports success while
// the content an author held stays unpublished), merge a change that is
// behind live over newer shared values, or tell a live language nothing.

import type {
  TransactionContext,
  TransactionOptions,
} from "@nextlyhq/adapter-drizzle/types";
import { getTableName, isTable } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { userWhoMay } from "../../../__tests__/fixtures/permission-holders";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  number,
  password,
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
import { VersionsRepository } from "../../versions/versions-repository";
import type { WebhookEvent } from "../../webhooks/types";

let current: TestNextly | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
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
  locale: string,
  collectionName = POSTS
): Promise<Record<string, unknown>[]> {
  return current!.adapter.select<Record<string, unknown>>(
    `dc_${collectionName}_locales`,
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
    _overwrite: true,
  });
  expect(es.success, JSON.stringify(es)).toBe(true);
  const held = await entries.updateEntry(at(id, "en"), {
    title: "Hello again",
    _overwrite: true,
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
        data: { _overwrite: true },
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
        _overwrite: true,
      });
      // Spanish's pending change begins from the live shared value...
      await entries.updateEntry(at(id, "es"), {
        title: "Hola otra vez",
        _overwrite: true,
      });
      // ...and English then publishes a new one.
      const newer = await entries.updateEntry(at(id, "en"), {
        tagline: "New",
        status: "published",
        _overwrite: true,
      });
      expect(newer.success, JSON.stringify(newer)).toBe(true);

      const refused = await entries.publishAllLocales({
        collectionName: POSTS,
        entryId: id,
        overrideAccess: true,
        data: { _overwrite: true },
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
        _overwrite: true,
      });
      expect(one.success, JSON.stringify(one)).toBe(true);
      const all = await entries.publishAllLocales({
        collectionName: POSTS,
        entryId: every,
        overrideAccess: true,
        data: { _overwrite: true },
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

    // The default language going live is told once, durably and to the
    // in-process subscribers. A draft entry whose default language's pending
    // change creates its translation row goes live through that row, so the
    // language's tagged `entry.published` is the transition, and an untagged
    // one beside it tells subscribers the same publication twice. The
    // plausible broken implementation decides the untagged event from the
    // translation rows stored before the publish, which the default language
    // has none of here.
    it("tells a draft entry's default language going live once, when its pending change creates its row", async () => {
      const entries = await boot(dialect);
      const created = await entries.createEntry(
        { collectionName: POSTS, overrideAccess: true, locale: "en" },
        { tagline: "Shared", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      // As on an install whose entry was live before it was translated: no
      // translation row of its own for the default language.
      await current!.adapter.delete(`dc_${POSTS}_locales`, {
        and: [{ column: "_locale", op: "=", value: "en" }],
      });
      const held = await entries.updateEntry(at(id, "en"), {
        title: "Hello",
        _overwrite: true,
      });
      expect(held.success, JSON.stringify(held)).toBe(true);
      expect(await pendingLocales(id)).toEqual(["en"]);
      // Taken down outside the app while English's change is held.
      await current!.adapter.update(
        `dc_${POSTS}`,
        { status: "draft" },
        { and: [{ column: "id", op: "=", value: id }] }
      );
      const before = await eventIds();
      const inProcess: unknown[] = [];
      current!.events.on("document.published", payload => {
        inProcess.push(payload);
      });

      const all = await entries.publishAllLocales({
        collectionName: POSTS,
        entryId: id,
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(all.success, JSON.stringify(all)).toBe(true);

      const rows = await current!.adapter.select<EventRow>("nextly_events");
      const published = rows
        .filter(row => !before.has(row.id))
        .map(
          row =>
            (typeof row.payload === "string"
              ? JSON.parse(row.payload)
              : row.payload) as WebhookEvent
        )
        .filter(
          event =>
            event.type === "entry.published" &&
            event.resource.kind === "entry" &&
            event.resource.id === id
        )
        .map(event => event.resource.locale);
      expect(published).toEqual(["en"]);
      await current!.events.settle();
      expect(inProcess).toHaveLength(1);
    });
  }
);

const GUARDED = "guardedpending";
const HEROES = "heropending";
const REMOVED = "removedpending";
const SEALED = "sealedpending";
const SEALED_BOX = "sealedboxpending";
const HOOKED = "hookedpending";
const LIMITED = "limitedpending";
const SEALED_BOX_COMPONENT = "sealedboxlabel";
const PUBLISHER = "publisher";

/** A version snapshot as stored, read back as the document it records. */
function snapshotOf(stored: unknown): unknown {
  return typeof stored === "string" ? JSON.parse(stored) : stored;
}

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
        _overwrite: true,
      });
      expect(held.success, JSON.stringify(held)).toBe(true);
      // POPULATION CONTROL: the edit is pending, not live.
      expect(await pendingLocales(id)).toEqual(["en"]);
      const note = { collectionName: GUARDED, id, locale: "en" };
      expect(await fieldIn(entries, note, "note")).toBe("Live");

      const publisher = { overrideAccess: false, user: { id: PUBLISHER } };
      const one = await entries.updateEntry(
        { collectionName: GUARDED, entryId: id, locale: "en", ...publisher },
        { status: "published", _overwrite: true }
      );
      const every = await entries.publishAllLocales({
        collectionName: GUARDED,
        entryId: id,
        ...publisher,
        data: { _overwrite: true },
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
        _overwrite: true,
      });
      expect(one.success, JSON.stringify(one)).toBe(true);
      const all = await entries.publishAllLocales({
        collectionName: POSTS,
        entryId: every,
        overrideAccess: true,
        data: { _overwrite: true },
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
        _overwrite: true,
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
        data: { _overwrite: true },
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
        _overwrite: true,
      });
      expect(sharedOnly.success, JSON.stringify(sharedOnly)).toBe(true);
      const withTitle = await entries.updateEntry(at(translated, "es"), {
        title: "Hola",
        _overwrite: true,
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
          data: { _overwrite: true },
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

    it("judges a pending change kept for a language the app no longer configures as told every language", async () => {
      const entries = await bootWith(
        dialect,
        defineCollection({
          slug: REMOVED,
          localized: true,
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title", localized: true }),
            // Writable only by a write told the default language alone.
            text({
              name: "note",
              localized: true,
              access: { update: ({ locale }) => locale === "en" },
            }),
          ],
        })
      );
      await userWhoMay(current!, PUBLISHER, "publish", [REMOVED]);
      const created = await entries.createEntry(
        { collectionName: REMOVED, overrideAccess: true, locale: "en" },
        { title: "Hello", note: "Live", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      const held = await entries.updateEntry(at(id, "es", REMOVED), {
        note: "Held",
        _overwrite: true,
      });
      expect(held.success, JSON.stringify(held)).toBe(true);
      // A language the site has since removed keeps its pending change: the
      // change held for Spanish, kept under French instead, which this site
      // does not configure.
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: REMOVED,
        entryId: id,
      };
      const drafts = new VersionsRepository(current!.adapter);
      const spanish = await drafts.findWorkingDraft(ref, "es");
      expect(JSON.stringify(spanish?.snapshot)).toContain("Held");
      await drafts.upsertWorkingDraft({
        ref,
        locale: "fr",
        snapshot: snapshotOf(spanish?.snapshot),
      });
      await drafts.deleteWorkingDraft(ref, "es");
      // POPULATION CONTROL: the only pending change is the removed language's.
      expect(await pendingLocales(id)).toEqual(["fr"]);

      const every = await entries.publishAllLocales({
        collectionName: REMOVED,
        entryId: id,
        overrideAccess: false,
        user: { id: PUBLISHER },
        data: { _overwrite: true },
      });

      // Told every language, as a write naming a language the site does not
      // configure is, the rule refuses the edit; told the default alone, it
      // would allow it.
      expect(every.success).toBe(false);
      expect((every as { publicData?: unknown }).publicData).toMatchObject({
        errors: [{ path: "note", code: "FORBIDDEN" }],
      });
      // Nothing went live, and the change is kept.
      expect(await translationRows(id, "fr", REMOVED)).toEqual([]);
      expect(
        await fieldIn(
          entries,
          { collectionName: REMOVED, id, locale: "en" },
          "note"
        )
      ).toBe("Live");
      expect(await pendingLocales(id)).toEqual(["fr"]);
    });

    // A change kept for a language the app no longer configures is judged
    // against that language's own stored components, read exactly as stored.
    // The plausible broken implementation resolves the removed language to
    // the default and compares the change with the default's components: a
    // protected value equal to the default's then reads as no edit, and the
    // publish writes it into the removed language's components.
    it("judges a removed language's pending change against that language's own stored components", async () => {
      const entries = await bootWith(
        dialect,
        defineCollection({
          slug: SEALED_BOX,
          localized: true,
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title", localized: true }),
            // No caller judged by the field rules may change it.
            fieldGroup({
              name: "box",
              component: SEALED_BOX_COMPONENT,
              access: { update: () => false },
            }),
          ],
        }),
        [
          defineFieldGroup({
            slug: SEALED_BOX_COMPONENT,
            localized: true,
            fields: [text({ name: "label" })],
          }),
        ]
      );
      await userWhoMay(current!, PUBLISHER, "publish", [SEALED_BOX]);
      const created = await entries.createEntry(
        { collectionName: SEALED_BOX, overrideAccess: true, locale: "en" },
        { title: "Hello", box: { label: "Default" }, status: "published" }
      );
      const id = (created.data as { id: string }).id;
      // Spanish live with its own label, then a change held for it that sets
      // the label back to the default's.
      const live = await entries.updateEntry(at(id, "es", SEALED_BOX), {
        title: "Hola",
        box: { label: "Spanish" },
        status: "published",
        _overwrite: true,
      });
      expect(live.success, JSON.stringify(live)).toBe(true);
      const held = await entries.updateEntry(at(id, "es", SEALED_BOX), {
        box: { label: "Default" },
        _overwrite: true,
      });
      expect(held.success, JSON.stringify(held)).toBe(true);
      // The site has since removed that language: its stored components and
      // its pending change are kept under French, which it does not configure.
      await current!.adapter.executeQuery(
        `UPDATE comp_${SEALED_BOX_COMPONENT}_locales SET _locale = 'fr' WHERE _locale = 'es'`
      );
      const ref = {
        scopeKind: "collection" as const,
        scopeSlug: SEALED_BOX,
        entryId: id,
      };
      const drafts = new VersionsRepository(current!.adapter);
      const spanish = await drafts.findWorkingDraft(ref, "es");
      await drafts.upsertWorkingDraft({
        ref,
        locale: "fr",
        snapshot: snapshotOf(spanish?.snapshot),
      });
      await drafts.deleteWorkingDraft(ref, "es");
      expect(await pendingLocales(id)).toEqual(["fr"]);

      const every = await entries.publishAllLocales({
        collectionName: SEALED_BOX,
        entryId: id,
        overrideAccess: false,
        user: { id: PUBLISHER },
        data: { _overwrite: true },
      });

      // French's stored label is "Spanish": the change edits the protected
      // field, and the publish refuses it rather than writing "Default" there.
      expect(every.success).toBe(false);
      expect((every as { publicData?: unknown }).publicData).toMatchObject({
        errors: [expect.objectContaining({ code: "FORBIDDEN" })],
      });
      const labels = await current!.adapter.executeQuery<{ label: string }>(
        `SELECT label FROM comp_${SEALED_BOX_COMPONENT}_locales WHERE _locale = 'fr'`
      );
      expect(labels.map(row => row.label)).toEqual(["Spanish"]);
      expect(await pendingLocales(id)).toEqual(["fr"]);
    });

    // A publish of every language that puts a pending change live runs the
    // update hooks a publish of that language alone runs, with the durable
    // document. The plausible broken implementations write the promoted
    // content directly and emit only status events, so a hook that ignores
    // the working-draft save never sees the content that went live; or pair
    // each promotion with a named language's document, which an unlocalized
    // collection, whose pending change belongs to no language, never has.
    it.each([
      { kind: "localized", localized: true },
      { kind: "unlocalized", localized: false },
    ])(
      "runs the update hooks a publish of one language runs, with the promoted document ($kind)",
      async ({ localized }) => {
        // An unlocalized collection's writes name no language.
        const locale = localized ? "en" : undefined;
        const seen: { title: unknown; draft: unknown }[] = [];
        const fieldValues: unknown[] = [];
        const entries = await bootWith(
          dialect,
          defineCollection({
            slug: HOOKED,
            localized,
            status: true,
            versions: { drafts: true },
            hooks: {
              // Config `afterChange` is the runtime `afterUpdate` phase.
              afterChange: [
                ctx => {
                  const data = (ctx.data ?? {}) as Record<string, unknown>;
                  seen.push({ title: data.title, draft: data._isWorkingDraft });
                },
              ],
            },
            fields: [
              text({
                name: "title",
                localized,
                hooks: {
                  afterChange: [
                    ({ value }: { value: unknown }) => {
                      fieldValues.push(value);
                      return value;
                    },
                  ],
                },
              }),
            ],
          })
        );
        const heldIn = async (): Promise<string> => {
          const created = await entries.createEntry(
            { collectionName: HOOKED, overrideAccess: true, locale },
            { title: "Hello", status: "published" }
          );
          const id = (created.data as { id: string }).id;
          const held = await entries.updateEntry(
            { ...at(id, "en", HOOKED), locale },
            {
              title: "Hello again",
              _overwrite: true,
            }
          );
          expect(held.success, JSON.stringify(held)).toBe(true);
          return id;
        };
        const alone = await heldIn();
        const every = await heldIn();
        const durable = () =>
          seen.filter(call => call.draft !== true).map(call => call.title);

        seen.length = 0;
        fieldValues.length = 0;
        const one = await entries.updateEntry(
          { ...at(alone, "en", HOOKED), locale },
          {
            status: "published",
            _overwrite: true,
          }
        );
        expect(one.success, JSON.stringify(one)).toBe(true);
        const byOne = { hook: durable(), field: [...fieldValues] };
        expect(byOne.hook).toContain("Hello again");

        seen.length = 0;
        fieldValues.length = 0;
        const all = await entries.publishAllLocales({
          collectionName: HOOKED,
          entryId: every,
          overrideAccess: true,
          data: { _overwrite: true },
        });
        expect(all.success, JSON.stringify(all)).toBe(true);
        expect({ hook: durable(), field: [...fieldValues] }).toEqual(byOne);
      }
    );

    // A pending change can rewrite the shared values beneath a language with
    // no change of its own, which then goes live over the new values. That
    // language is judged as it will land: its own translated values over the
    // shared values the publish leaves. The plausible broken implementation
    // judges it over the shared values as they stood, so a change that makes
    // another language's live text invalid publishes it.
    it("refuses a change whose shared value makes a language without a change of its own invalid", async () => {
      const entries = await bootWith(
        dialect,
        defineCollection({
          slug: LIMITED,
          localized: true,
          status: true,
          versions: { drafts: true },
          fields: [
            number({ name: "titleLimit", localized: false }),
            text({
              name: "title",
              localized: true,
              validate: (value, { data }) =>
                typeof value === "string" &&
                typeof data.titleLimit === "number" &&
                value.length > data.titleLimit
                  ? "Longer than the limit."
                  : true,
            }),
          ],
        })
      );
      const created = await entries.createEntry(
        { collectionName: LIMITED, overrideAccess: true, locale: "en" },
        { title: "Hello", titleLimit: 10, status: "published" }
      );
      const id = (created.data as { id: string }).id;
      // Spanish live with seven characters, within ten.
      const spanish = await entries.updateEntry(at(id, "es", LIMITED), {
        title: "Saludos",
        status: "published",
        _overwrite: true,
      });
      expect(spanish.success, JSON.stringify(spanish)).toBe(true);
      // English's change lowers the shared limit to five, which its own
      // title meets and Spanish's does not.
      const held = await entries.updateEntry(at(id, "en", LIMITED), {
        title: "Hi",
        titleLimit: 5,
        _overwrite: true,
      });
      expect(held.success, JSON.stringify(held)).toBe(true);
      expect(await pendingLocales(id)).toEqual(["en"]);

      const every = await entries.publishAllLocales({
        collectionName: LIMITED,
        entryId: id,
        overrideAccess: true,
        data: { _overwrite: true },
      });

      expect(every.success, JSON.stringify(every)).toBe(false);
      expect(every.statusCode).toBe(400);
      expect((every as { publicData?: unknown }).publicData).toMatchObject({
        errors: [expect.objectContaining({ path: "title" })],
      });
      // Nothing went live: the limit is still ten and English's change waits.
      const read = await entries.getEntry(at(id, "es", LIMITED));
      expect(read.data as Record<string, unknown>).toMatchObject({
        title: "Saludos",
        titleLimit: 10,
      });
      expect(await pendingLocales(id)).toEqual(["en"]);
    });

    it("consumes pending changes the schema no longer lets it promote, putting none of them live", async () => {
      const entries = await bootWith(
        dialect,
        defineCollection({
          slug: SEALED,
          status: true,
          versions: { drafts: true },
          fields: [
            text({ name: "title" }),
            // A password field rules the draft split out: this collection
            // can neither hold nor promote a pending change.
            password({ name: "secret" }),
          ],
        })
      );
      const created = await entries.createEntry(
        { collectionName: SEALED, overrideAccess: true },
        { title: "Live", status: "published" }
      );
      const id = (created.data as { id: string }).id;
      // A pending change held before the schema made the split ineligible,
      // stored as the write path stores one.
      await new VersionsRepository(current!.adapter).upsertWorkingDraft({
        ref: { scopeKind: "collection", scopeSlug: SEALED, entryId: id },
        locale: null,
        snapshot: { title: "Stale" },
      });
      // POPULATION CONTROL: the change is there to be consumed.
      expect(await pendingLocales(id)).toEqual(["(none)"]);

      const published = await entries.publishAllLocales({
        collectionName: SEALED,
        entryId: id,
        overrideAccess: true,
        data: { _overwrite: true },
      });
      expect(published.success, JSON.stringify(published)).toBe(true);

      // As a publish of one language consumes it: none of it live, and no
      // pending change left to resurface if the split is turned back on.
      expect(await pendingLocales(id)).toEqual([]);
      const read = await entries.getEntry({
        collectionName: SEALED,
        entryId: id,
        overrideAccess: true,
      });
      expect((read.data as { title?: unknown } | null)?.title).toBe("Live");
    });
  }
);

// The reads a publish of every language makes under the entry's lock, of the
// tables each language's document is read from, do not grow with the
// languages it tells. The plausible broken implementation reads each told
// language's document alone, before the publish and after it, so every
// translation and component table is read twice more for each language.
const READS = "readsposts";
const READS_BANNER = "readsbanner";

/**
 * The translation and component tables the adapter's transactions read, each
 * time one is read: every select made through a transaction's own handle.
 */
function countDocumentReads(read: string[]): void {
  const adapter = current!.adapter;
  const original = adapter.transaction.bind(adapter);
  const counted = (tx: TransactionContext): TransactionContext => {
    type Select = (...args: unknown[]) => {
      from: (table: unknown, ...rest: unknown[]) => unknown;
    };
    const db = tx.getDrizzle<{ select: Select }>();
    const select = db.select.bind(db);
    vi.spyOn(db, "select").mockImplementation((...args: unknown[]) => {
      const builder = select(...args);
      const from = builder.from.bind(builder);
      builder.from = (table: unknown, ...rest: unknown[]) => {
        const name = isTable(table) ? getTableName(table) : undefined;
        if (
          name === `dc_${READS}_locales` ||
          name?.startsWith("comp_") === true
        ) {
          read.push(name);
        }
        return from(table, ...rest);
      };
      return builder;
    });
    vi.spyOn(tx, "getDrizzle").mockReturnValue(db);
    return tx;
  };
  vi.spyOn(adapter, "transaction").mockImplementation(
    <T>(
      work: (tx: TransactionContext) => Promise<T>,
      options?: TransactionOptions
    ) => original(tx => work(counted(tx)), options)
  );
}

/** Each table read, with how many times. */
function tally(read: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name of read) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}

describe.each(getConfiguredTestDialects())(
  "the reads a publish of every language makes under the lock (integration, %s)",
  dialect => {
    it("reads each document table as often for four languages as for two", async () => {
      current = await createTestNextly({
        dialect,
        fieldGroups: [
          defineFieldGroup({
            slug: READS_BANNER,
            fields: [text({ name: "heading" })],
          }),
        ],
        collections: [
          defineCollection({
            slug: READS,
            localized: true,
            status: true,
            versions: { drafts: true },
            fields: [
              text({ name: "title", localized: true }),
              fieldGroup({ name: "banner", component: READS_BANNER }),
            ],
          }),
        ],
        localization: {
          locales: ["en", "es", "fr", "de"],
          defaultLocale: "en",
        },
      });
      const entries = (
        current.getService("collectionsHandler") as CollectionsHandler
      ).getEntryService() as CollectionEntryService;
      // A draft in `locales`, each translated: a publish of every language
      // tells each of them.
      const draftIn = async (locales: readonly string[]): Promise<string> => {
        const created = await entries.createEntry(
          { collectionName: READS, overrideAccess: true, locale: "en" },
          { title: "en", banner: { heading: "Banner" }, status: "draft" }
        );
        const id = (created.data as { id: string }).id;
        for (const locale of locales.filter(code => code !== "en")) {
          const saved = await entries.updateEntry(at(id, locale, READS), {
            title: locale,
            _overwrite: true,
          });
          expect(saved.success, JSON.stringify(saved)).toBe(true);
        }
        return id;
      };
      const two = await draftIn(["en", "es"]);
      const four = await draftIn(["en", "es", "fr", "de"]);

      const readsOf = async (id: string): Promise<Record<string, number>> => {
        const read: string[] = [];
        countDocumentReads(read);
        const published = await entries.publishAllLocales({
          collectionName: READS,
          entryId: id,
          overrideAccess: true,
          data: { _overwrite: true },
        });
        vi.restoreAllMocks();
        expect(published.success, JSON.stringify(published)).toBe(true);
        return tally(read);
      };
      const forTwo = await readsOf(two);
      const forFour = await readsOf(four);

      expect(forTwo[`dc_${READS}_locales`]).toBeGreaterThan(0);
      expect(forFour).toEqual(forTwo);
    });
  }
);
