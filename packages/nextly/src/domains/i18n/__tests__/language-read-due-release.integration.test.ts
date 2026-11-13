/**
 * A public read in a language answers as the document's release has it.
 *
 * A document-wide publish release that has come due makes its document
 * public before the release's own rows are written: the read's lifecycle
 * bound admits it at once. The requested language admits it too, so a due
 * release is not found in a language until its materializer has run.
 */
import { afterEach, describe, expect, it } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, relationship, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { seedPlainAuthor } from "../../releases/__tests__/helpers/live-author";
import { scheduleAsItStands } from "../../releases/__tests__/helpers/release-writes";
import { ReleasesRepository } from "../../releases/releases-repository";

const SLUG = "ldr_posts";
/** Published notes, each relating a post. */
const NOTES = "ldr_notes";
const PAST = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date("2099-01-01T00:00:00Z");

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    seedPublic: true,
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        status: true,
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: NOTES,
        status: true,
        access: { read: () => true },
        fields: [
          text({ name: "title" }),
          relationship({ name: "post", relationTo: SLUG }),
        ],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return current;
}

const handlerOf = (t: TestNextly) =>
  t.getService("collectionsHandler") as CollectionsHandler;

/** A draft with an English and a Spanish title, held by a release that publishes it. */
async function draftInRelease(
  t: TestNextly,
  scheduledAt: Date
): Promise<string> {
  const handler = handlerOf(t);
  const created = await handler.createEntry(
    { collectionName: SLUG, overrideAccess: true, locale: "en" },
    { title: "Harbour", status: "draft" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  const spanish = await handler.updateEntry(
    { collectionName: SLUG, entryId: id, overrideAccess: true, locale: "es" },
    { title: "Puerto", _overwrite: true }
  );
  expect(spanish.success, JSON.stringify(spanish)).toBe(true);

  const author = await seedPlainAuthor(t);
  await grantTo(t, author, "update", [SLUG]);
  await grantTo(t, author, "publish", [SLUG]);
  const release = await t.nextly.releases.create({ title: "Go live" });
  await t.nextly.releases.addMember({
    releaseId: release.id,
    scopeKind: "collection",
    scopeSlug: SLUG,
    entryId: id,
    // Document-wide: every language goes live with it.
    locale: null,
    action: "publish",
    userId: author,
  });
  expect(
    (await t.nextly.releases.readiness({ releaseId: release.id })).hard
  ).toEqual([]);
  await scheduleAsItStands(
    new ReleasesRepository(t.adapter),
    release.id,
    scheduledAt,
    "UTC"
  );
  return id;
}

/** What a visitor's read in Spanish finds: the entry by id, and the list's ids. */
async function inSpanish(t: TestNextly, id: string) {
  const handler = handlerOf(t);
  const one = await handler.getEntry({
    collectionName: SLUG,
    entryId: id,
    locale: "es",
  });
  const list = await handler.listEntries({
    collectionName: SLUG,
    locale: "es",
    limit: 50,
  });
  return {
    found: one.success === true,
    listed: ((list.data?.docs ?? []) as { id: string }[]).map(row => row.id),
  };
}

describe.each(getConfiguredTestDialects())(
  "a public read in a language and a due release (%s)",
  dialect => {
    it("finds a document a due release publishes, in a language its rows have not reached", async () => {
      const t = await boot(dialect);
      const id = await draftInRelease(t, PAST);
      expect(await inSpanish(t, id)).toEqual({ found: true, listed: [id] });
    }, 90_000);

    // A due release publishes each language's row as it stands, so the read
    // it admits shows those values, in its own language, beside it and in a
    // list, not the nothing a published-only filter leaves.
    it("shows the translated values a due release publishes", async () => {
      const t = await boot(dialect);
      const id = await draftInRelease(t, PAST);
      const handler = handlerOf(t);
      const one = await handler.getEntry({
        collectionName: SLUG,
        entryId: id,
        locale: "es",
        translations: "all",
      });
      expect(one.success, JSON.stringify(one)).toBe(true);
      const read = one.data as Record<string, unknown>;
      expect(read.title).toBe("Puerto");
      expect(read._allLocales).toMatchObject({
        title: { en: "Harbour", es: "Puerto" },
      });
      const list = await handler.listEntries({
        collectionName: SLUG,
        locale: "es",
        limit: 50,
      });
      const titles = ((list.data?.docs ?? []) as { title?: unknown }[]).map(
        row => row.title
      );
      expect(titles).toEqual(["Puerto"]);
    }, 90_000);

    // A related document a due release publishes is read as the release
    // will publish it too: its Spanish value, not the nothing a
    // published-only filter leaves.
    it("shows a related document's translated values a due release publishes", async () => {
      const t = await boot(dialect);
      const id = await draftInRelease(t, PAST);
      const handler = handlerOf(t);
      const note = await handler.createEntry(
        { collectionName: NOTES, overrideAccess: true, locale: "en" },
        { title: "Note", post: id, status: "published" }
      );
      const noteId = (note.data as { id?: string } | undefined)?.id;
      expect(typeof noteId, JSON.stringify(note)).toBe("string");
      const read = await handler.getEntry({
        collectionName: NOTES,
        entryId: noteId as string,
        locale: "es",
        depth: 1,
      });
      expect(read.success, JSON.stringify(read)).toBe(true);
      const post = (read.data as Record<string, unknown>).post as Record<
        string,
        unknown
      >;
      expect(post.title).toBe("Puerto");
    }, 90_000);

    // The control: a release not yet due reveals nothing, so the draft is not
    // found in Spanish.
    it("does not find it before the release is due", async () => {
      const t = await boot(dialect);
      const id = await draftInRelease(t, FUTURE);
      expect(await inSpanish(t, id)).toEqual({ found: false, listed: [] });
    }, 90_000);
  }
);
