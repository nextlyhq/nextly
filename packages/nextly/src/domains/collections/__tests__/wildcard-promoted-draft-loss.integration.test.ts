/**
 * What a wildcard publish owes a pending edit it promotes.
 *
 * The promotion splits a draft's fields by NAME, so a localized value lands in
 * the companion payload whichever language the draft belongs to. The companion
 * write is then skipped for a wildcard, and the delete that follows is
 * unconditional. These tests state the property spanning all three: an edit an
 * author saved is either readable or still pending, never neither.
 *
 * @module domains/collections/__tests__/wildcard-promoted-draft-loss.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "drafted";
/** Localized title PLUS a shared field, so a draft can touch only the shared one. */
const SHARED_SLUG = "sharedfield";

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title", localized: true })],
      }),
      defineCollection({
        slug: SHARED_SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [
          text({ name: "title", localized: true }),
          // Shared across languages: a localized collection localizes every
          // field unless one opts out, so this has to say so explicitly.
          text({ name: "note", localized: false }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

/**
 * What a reader actually gets for one language — the oracle, in place of any
 * table the value might sit in. `status: "all"` is the widest view the product
 * offers: a value absent from it is absent from every read path.
 */
async function readTitle(
  t: TestNextly,
  id: string,
  locale: string,
  everyStatus = true
): Promise<unknown> {
  const doc = (await t.nextly.findByID({
    collection: SLUG as never,
    id,
    locale,
    overrideAccess: true,
    ...(everyStatus ? { status: "all" } : {}),
  } as never)) as Record<string, unknown> | null;
  return doc?.title;
}

/** Every pending working draft this entry holds. */
async function pendingDrafts(t: TestNextly, id: string): Promise<string> {
  // `nextly_versions` is a mapped system table: its rows come back camelCased,
  // unlike the dynamic content tables, whose columns stay snake_case.
  const rows = await t.adapter.select<{
    entryId?: unknown;
    versionNo?: unknown;
    snapshot?: unknown;
  }>("nextly_versions", {});
  return JSON.stringify(
    rows.filter(r => String(r.entryId) === id && r.versionNo === null)
  );
}

/** An entry that exists in German only, with its main row published. */
async function germanOnlyAndPublished(t: TestNextly): Promise<string> {
  const created = await handlerOf(t).createEntry(
    { collectionName: SLUG, overrideAccess: true, locale: "de" },
    { title: "DE live", status: "published" }
  );
  const id = (created.data as { id?: string } | undefined)?.id;
  if (typeof id !== "string") throw new Error("no id from create");
  await handlerOf(t).updateEntry(
    { collectionName: SLUG, entryId: id, overrideAccess: true, locale: "*" },
    { status: "published" }
  );
  return id;
}

describe.each(getConfiguredTestDialects())(
  "a wildcard publish and the draft it promotes (%s)",
  dialect => {
    it("does not lose a promoted edit it never writes", async () => {
      const t = await boot(dialect);
      const id = await germanOnlyAndPublished(t);

      await handlerOf(t).updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { title: "EN pending" }
      );

      // POPULATION CONTROL: the edit really was held. Without it, a later
      // "nothing pending" reads as the defect when it could equally mean the
      // save never became a draft and the test proves nothing.
      expect(await pendingDrafts(t, id)).toContain("EN pending");

      const result = await handlerOf(t).updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "*",
        },
        { status: "published" }
      );

      const readable = await readTitle(t, id, "en");
      const stillPending = (await pendingDrafts(t, id)).includes("EN pending");
      expect(readable === "EN pending" || stillPending).toBe(true);
      if (!result.success) expect(stillPending).toBe(true);
    });

    it("CONTROL: the same edit survives a publish that names the language", async () => {
      const t = await boot(dialect);
      const id = await germanOnlyAndPublished(t);

      await handlerOf(t).updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { title: "EN pending" }
      );
      expect(await pendingDrafts(t, id)).toContain("EN pending");

      await handlerOf(t).updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { status: "published" }
      );

      const readable = await readTitle(t, id, "en");
      const stillPending = (await pendingDrafts(t, id)).includes("EN pending");
      expect(readable === "EN pending" || stillPending).toBe(true);
    });

    it("creates no translation row when the promoted draft touches only shared fields", async () => {
      // The exception exists for AUTHORED translation values. A draft that
      // changed only a shared field carries none, so the language still has no
      // translation and none may be invented for it — `_status` travelling in
      // the companion payload is a structural key, not content.
      const t = await boot(dialect);
      const created = await handlerOf(t).createEntry(
        { collectionName: SHARED_SLUG, overrideAccess: true, locale: "de" },
        { title: "DE live", note: "n1", status: "published" }
      );
      const id = (created.data as { id?: string } | undefined)?.id;
      if (typeof id !== "string") throw new Error("no id from create");
      await handlerOf(t).updateEntry(
        {
          collectionName: SHARED_SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "*",
        },
        { status: "published" }
      );

      const before = await t.adapter.select<{ _locale?: unknown }>(
        `dc_${SHARED_SLUG}_locales`,
        {}
      );
      expect(before.map(r => String(r._locale)).sort()).toEqual(["de"]);

      // A status-less save of the SHARED field only, at the default locale.
      await handlerOf(t).updateEntry(
        {
          collectionName: SHARED_SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { note: "n2" }
      );
      expect(await pendingDrafts(t, id)).toContain("n2");

      await handlerOf(t).updateEntry(
        {
          collectionName: SHARED_SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "*",
        },
        { status: "published" }
      );

      // No English row was manufactured for a language nobody translated.
      const after = await t.adapter.select<{ _locale?: unknown }>(
        `dc_${SHARED_SLUG}_locales`,
        {}
      );
      expect(after.map(r => String(r._locale)).sort()).toEqual(["de"]);
    });

    it("CONTROL: the language that does have a translation is unaffected", async () => {
      const t = await boot(dialect);
      const id = await germanOnlyAndPublished(t);

      await handlerOf(t).updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "en",
        },
        { title: "EN pending" }
      );
      await handlerOf(t).updateEntry(
        {
          collectionName: SLUG,
          entryId: id,
          overrideAccess: true,
          locale: "*",
        },
        { status: "published" }
      );

      expect(await readTitle(t, id, "de", false)).toBe("DE live");
    });
  }
);
