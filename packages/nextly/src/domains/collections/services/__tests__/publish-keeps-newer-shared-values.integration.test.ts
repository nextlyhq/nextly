/**
 * Publishing a language's pending change never puts back a shared value that
 * someone else published after the change began.
 *
 * A pending change holds a whole copy of the document, shared fields
 * included. Publishing it writes those shared values onto the live row, so a
 * change English began before Spanish published Article Count 13 would put
 * English's older count back. Each pending change records the version it
 * began from, its base; a shared field whose live value has moved off the
 * base is out of date, and the publish is refused, naming it. Taking the live
 * values brings the change up to date and moves its base, and the publish
 * then goes through.
 *
 * Every refusal is paired with what stayed live, and every success with what
 * went live: a refusal alone is satisfied by a publish that refuses
 * everything.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, number, text } from "../../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../../services/collections-handler";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

const COLLECTION = "articles";

async function boot(
  dialect: TestDialect,
  maxPerDoc: number | false = false
): Promise<CollectionEntryService> {
  handle = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: COLLECTION,
        localized: true,
        status: true,
        versions: { drafts: true, maxPerDoc },
        // The title is translated; the count is shared by every language.
        fields: [text({ name: "title" }), number({ name: "articleCount" })],
      }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  return (
    handle.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService() as CollectionEntryService;
}

function save(
  entries: CollectionEntryService,
  id: string,
  locale: string,
  body: Record<string, unknown>
) {
  return entries.updateEntry(
    { collectionName: COLLECTION, entryId: id, overrideAccess: true, locale },
    body
  );
}

/** A document live in English, and in Spanish unless told otherwise. */
async function live(
  entries: CollectionEntryService,
  { spanish = true }: { spanish?: boolean } = {}
): Promise<string> {
  const created = await entries.createEntry(
    { collectionName: COLLECTION, overrideAccess: true, locale: "en" },
    { title: "en title", articleCount: 10, status: "published" }
  );
  const id = (created.data as { id: string }).id;
  if (spanish) {
    expect(
      (
        await save(entries, id, "es", {
          title: "es title",
          status: "published",
        })
      ).success
    ).toBe(true);
  }
  return id;
}

async function liveValues(
  entries: CollectionEntryService,
  id: string,
  locale: string
): Promise<{ title: unknown; articleCount: unknown }> {
  const res = await entries.getEntry({
    collectionName: COLLECTION,
    entryId: id,
    overrideAccess: true,
    locale,
  });
  const data = res.data as { title?: unknown; articleCount?: unknown };
  return { title: data.title, articleCount: data.articleCount };
}

async function pendingLocales(entryId: string): Promise<string[]> {
  const rows = await handle!.adapter.select<{ locale: string | null }>(
    "nextly_versions",
    {
      where: {
        and: [
          { column: "entryId", op: "=", value: entryId },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NULL" },
          { column: "status", op: "=", value: "draft" },
        ],
      },
    }
  );
  return rows.map(r => r.locale ?? "(none)").sort();
}

/** The version numbers a pending change's base is pinned to, by slot. */
async function basePins(
  entryId: string
): Promise<Array<{ slot: string; versionNo: number }>> {
  return handle!.adapter.select<{ slot: string; versionNo: number }>(
    "nextly_version_pins",
    {
      columns: ["slot", "versionNo"],
      where: {
        and: [
          { column: "entryId", op: "=", value: entryId },
          { column: "holder", op: "=", value: "shared-publish-base" },
        ],
      },
    }
  );
}

/** The 2026-10-15 walk up to the English publish. */
async function spanishPublishesThirteen(
  entries: CollectionEntryService
): Promise<string> {
  const id = await live(entries);
  // English begins a pending change while the count is 10.
  expect((await save(entries, id, "en", { title: "en edited" })).success).toBe(
    true
  );
  // Spanish publishes 13.
  expect((await save(entries, id, "es", { articleCount: 13 })).success).toBe(
    true
  );
  expect((await save(entries, id, "es", { status: "published" })).success).toBe(
    true
  );
  expect((await liveValues(entries, id, "es")).articleCount).toBe(13);
  return id;
}

function publish(entries: CollectionEntryService, id: string, locale: string) {
  return save(entries, id, locale, { status: "published" });
}

describe.each(getConfiguredTestDialects())(
  "publishing a pending change on %s",
  dialect => {
    it("refuses an English change older than Spanish's publish, naming the count, and keeps 13", async () => {
      const entries = await boot(dialect);
      const id = await spanishPublishesThirteen(entries);

      const refused = await publish(entries, id, "en");

      expect({
        success: refused.success,
        statusCode: refused.statusCode,
        publicData: refused.publicData,
      }).toEqual({
        success: false,
        statusCode: 409,
        publicData: { outOfDate: ["articleCount"] },
      });
      // Nothing changed: 13 is live, English's title is not, and English's
      // pending change is still there to bring up to date.
      expect(await liveValues(entries, id, "en")).toEqual({
        title: "en title",
        articleCount: 13,
      });
      expect(await pendingLocales(id)).toEqual(["en"]);
    });

    it("keeps the base where the change began when English saves again after Spanish's publish", async () => {
      const entries = await boot(dialect);
      const id = await spanishPublishesThirteen(entries);
      // A newer save of an unrelated, translated field does not make English's
      // old count current.
      expect(
        (await save(entries, id, "en", { title: "en edited again" })).success
      ).toBe(true);

      const refused = await publish(entries, id, "en");

      expect(refused.statusCode).toBe(409);
      expect(refused.publicData).toEqual({ outOfDate: ["articleCount"] });
      expect((await liveValues(entries, id, "en")).articleCount).toBe(13);
    });

    it("publishes once English takes the live values, and keeps 13", async () => {
      const entries = await boot(dialect);
      const id = await spanishPublishesThirteen(entries);

      const taken = await entries.takeLiveSharedValues({
        collectionName: COLLECTION,
        entryId: id,
        overrideAccess: true,
        locale: "en",
      });
      expect(taken.success).toBe(true);
      const published = await publish(entries, id, "en");

      expect(published.success).toBe(true);
      expect(await liveValues(entries, id, "en")).toEqual({
        title: "en edited",
        articleCount: 13,
      });
      expect(await pendingLocales(id)).toEqual([]);
    });

    it("publishes a change whose shared values nobody else moved, its own edit included", async () => {
      const entries = await boot(dialect);
      const id = await live(entries);
      // English edits the shared count itself; nobody publishes meanwhile.
      expect(
        (
          await save(entries, id, "en", {
            title: "en edited",
            articleCount: 11,
          })
        ).success
      ).toBe(true);

      const published = await publish(entries, id, "en");

      expect(published.success).toBe(true);
      expect(await liveValues(entries, id, "en")).toEqual({
        title: "en edited",
        articleCount: 11,
      });
      // The base goes with the change it belonged to.
      expect(await basePins(id)).toEqual([]);
    });

    it("refuses a change saved without a base that differs from live, naming the field", async () => {
      const entries = await boot(dialect);
      const id = await spanishPublishesThirteen(entries);
      // A pending change saved before bases were recorded.
      await handle!.adapter.delete("nextly_version_pins", {
        and: [{ column: "entryId", op: "=", value: id }],
      });
      expect(await basePins(id)).toEqual([]);

      const refused = await publish(entries, id, "en");

      expect(refused.statusCode).toBe(409);
      expect(refused.publicData).toEqual({ outOfDate: ["articleCount"] });
      expect((await liveValues(entries, id, "en")).articleCount).toBe(13);
    });

    it("publishes a change saved without a base whose shared values match live", async () => {
      const entries = await boot(dialect);
      const id = await live(entries);
      expect(
        (await save(entries, id, "en", { title: "en edited" })).success
      ).toBe(true);
      await handle!.adapter.delete("nextly_version_pins", {
        and: [{ column: "entryId", op: "=", value: id }],
      });

      const published = await publish(entries, id, "en");

      expect(published.success).toBe(true);
      expect((await liveValues(entries, id, "en")).title).toBe("en edited");
    });

    it("refuses after a language not yet published saves the count in place, until English takes the live values", async () => {
      const entries = await boot(dialect);
      // Spanish saved as a draft is not held: the save writes the live row
      // directly, shared count included, with no publish.
      const id = await live(entries, { spanish: false });
      expect(
        (await save(entries, id, "en", { title: "en edited" })).success
      ).toBe(true);
      expect(
        (
          await save(entries, id, "es", {
            title: "es",
            articleCount: 13,
            status: "draft",
          })
        ).success
      ).toBe(true);
      expect((await liveValues(entries, id, "en")).articleCount).toBe(13);

      const refused = await publish(entries, id, "en");
      expect(refused.statusCode).toBe(409);
      expect(refused.publicData).toEqual({ outOfDate: ["articleCount"] });

      expect(
        (
          await entries.takeLiveSharedValues({
            collectionName: COLLECTION,
            entryId: id,
            overrideAccess: true,
            locale: "en",
          })
        ).success
      ).toBe(true);
      const published = await publish(entries, id, "en");

      expect(published.success).toBe(true);
      expect(await liveValues(entries, id, "en")).toEqual({
        title: "en edited",
        articleCount: 13,
      });
    });

    it("keeps a pending change's base through retention", async () => {
      // A cap of 2: the version English began from is soon among the oldest.
      const entries = await boot(dialect, 2);
      const id = await live(entries);
      expect(
        (await save(entries, id, "en", { title: "en edited" })).success
      ).toBe(true);
      const [pin] = await basePins(id);
      expect(pin).toBeDefined();
      for (const count of [11, 12, 13]) {
        expect(
          (await save(entries, id, "es", { articleCount: count })).success
        ).toBe(true);
        expect(
          (await save(entries, id, "es", { status: "published" })).success
        ).toBe(true);
      }

      const base = await handle!.adapter.select<{ versionNo: number }>(
        "nextly_versions",
        {
          columns: ["versionNo"],
          where: {
            and: [
              { column: "entryId", op: "=", value: id },
              { column: "versionNo", op: "=", value: pin!.versionNo },
            ],
          },
        }
      );
      expect(base).toHaveLength(1);
      // And it still answers the question it was kept for.
      const refused = await publish(entries, id, "en");
      expect(refused.publicData).toEqual({ outOfDate: ["articleCount"] });
    });
  }
);
