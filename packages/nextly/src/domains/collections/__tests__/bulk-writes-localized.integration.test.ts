/**
 * A bulk write reaches a localized collection's companion table.
 *
 * A localized collection keeps its translatable values in `<table>_locales`
 * and the migrated main table has no columns for them. `createEntry` splits a
 * write accordingly; the shared bulk implementation did not, so `createMany`
 * failed EVERY row with the driver's own message ("table dc_x has no column
 * named y") and the batch update had the same gap one function down.
 *
 * Asserted against the real companion row rather than the API's answer alone:
 * a read that resolved through the fallback chain would look identical whether
 * the translation was stored or not.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface CompanionRow {
  _parent: string;
  _locale: string;
  _updated_at?: unknown;
  title?: unknown;
  kind?: unknown;
}

async function boot(): Promise<TestNextly> {
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    memory: true,
  } as Parameters<typeof createAdapter>[0]);
  current = await createTestNextly({
    adapter,
    collections: [
      defineCollection({
        slug: "pages",
        localized: true,
        access: {
          create: () => true,
          read: () => true,
          update: () => true,
        },
        versions: true,
        // `metaTitle` becomes `meta_title` in the companion: the column and the
        // field name differ, which is where a reattachment by column shows.
        fields: [
          text({ name: "title" }),
          text({ name: "kind" }),
          text({ name: "metaTitle" }),
        ],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

/** The companion rows as the database holds them, not as a read resolves them. */
async function companionRows(handle: TestNextly): Promise<CompanionRow[]> {
  return handle.adapter.executeQuery<CompanionRow>(
    'SELECT "_parent", "_locale", "_updated_at", "title", "kind" FROM "dc_pages_locales" ORDER BY "title"'
  );
}

describe("a bulk write on a localized collection", () => {
  it("creates every row and stores each one's translatable values in the companion", async () => {
    const handle = await boot();
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    const result = await entries.createEntries(
      { collectionName: "pages", overrideAccess: true },
      [
        { title: "first", kind: "one" },
        { title: "second", kind: "two" },
      ]
    );

    expect(result.errors).toEqual([]);
    expect(result.successful).toBe(2);

    const rows = await companionRows(handle);
    expect(rows.map(r => [r.title, r.kind])).toEqual([
      ["first", "one"],
      ["second", "two"],
    ]);
    // Every row in the write's language, which is the default: these paths
    // refuse a named locale.
    expect([...new Set(rows.map(r => r._locale))]).toEqual(["en"]);
    expect(new Set(rows.map(r => r._parent)).size).toBe(2);
    // Each new translation carries the staleness stamp. Without it the row
    // reads as UNKNOWN age and is never reported stale — a signal that never
    // fires for new content is invisible, so the create must not skip it.
    expect(
      rows.every(r => r._updated_at !== null && r._updated_at !== undefined)
    ).toBe(true);

    // And the values come back out through an ordinary read.
    const listed = await handler.listEntries({
      collectionName: "pages",
      overrideAccess: true,
    });
    const docs = (listed.data as { docs: Array<Record<string, unknown>> }).docs;
    expect(docs.map(d => d.kind).sort()).toEqual(["one", "two"]);
  });

  it("writes a batch update's translatable values to the companion row", async () => {
    const handle = await boot();
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    await entries.createEntries(
      { collectionName: "pages", overrideAccess: true },
      [{ title: "first", kind: "one" }]
    );
    const [created] = await companionRows(handle);

    const updated = await entries.updateEntries(
      { collectionName: "pages", overrideAccess: true },
      [{ id: created._parent, data: { kind: "edited" } }]
    );

    expect(updated.errors).toEqual([]);
    expect(updated.successful).toBe(1);

    const rows = await companionRows(handle);
    expect(rows).toHaveLength(1);
    // The patched field moved; the one the patch did not name stayed.
    expect(rows[0].kind).toBe("edited");
    expect(rows[0].title).toBe("first");
    expect(rows[0]._locale).toBe("en");
  });

  it("carries the whole locale, the field's own name and the write's locale into what it records", async () => {
    const handle = await boot();
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    await entries.createEntries(
      { collectionName: "pages", overrideAccess: true },
      [{ title: "first", kind: "one", metaTitle: "meta" }]
    );
    const [created] = await companionRows(handle);

    // A patch naming ONE translatable field. What is recorded must still be
    // the whole document in this language, not the one field that moved.
    await entries.updateEntries(
      { collectionName: "pages", overrideAccess: true },
      [{ id: created._parent, data: { kind: "edited" } }]
    );

    const events = await handle.adapter.select<{
      type: string;
      payload: unknown;
    }>("nextly_events");
    const documents = events
      .filter(e => e.type === "entry.created" || e.type === "entry.updated")
      .map(e => {
        const envelope = (
          typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload
        ) as { resource?: { id?: string }; data?: Record<string, unknown> };
        return { id: envelope.resource?.id, doc: envelope.data ?? {} };
      })
      .filter(d => d.id === created._parent);
    expect(documents).toHaveLength(2);
    for (const { doc } of documents) {
      // Under the FIELD's name, not the column's.
      expect(doc).toHaveProperty("metaTitle", "meta");
      expect(doc).not.toHaveProperty("meta_title");
    }
    // The update's document carries the fields its patch never named.
    const afterUpdate = documents[1].doc;
    expect(afterUpdate.kind).toBe("edited");
    expect(afterUpdate.title).toBe("first");

    // Both versions are tagged with the language their values belong to;
    // untagged, a restore reads them as shared and drops them.
    const versions = await handle.adapter.select<{
      locale: unknown;
      entry_id?: string;
      entryId?: string;
    }>("nextly_versions");
    const mine = versions.filter(
      v => (v.entry_id ?? v.entryId) === created._parent
    );
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect([...new Set(mine.map(v => v.locale))]).toEqual(["en"]);
  });

  it("rolls the batch back when the companion write fails, rather than committing a parent without it", async () => {
    const handle = await boot();
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    // One write first, so readiness is remembered as it is in production;
    // then the companion goes out from under it — schema drift, which is the
    // shape this guard is for.
    await entries.createEntries(
      { collectionName: "pages", overrideAccess: true },
      [{ title: "first", kind: "one" }]
    );
    await handle.adapter.executeQuery('DROP TABLE "dc_pages_locales"');
    const before = await handle.adapter.executeQuery<{ n: number }>(
      'SELECT COUNT(*) AS n FROM "dc_pages"'
    );

    const result = await entries
      .createEntries({ collectionName: "pages", overrideAccess: true }, [
        { title: "second", kind: "two" },
      ])
      .catch(() => ({ successful: 0, failed: 1, errors: [{}] }));

    expect(result.successful).toBe(0);
    // The parent row did not survive: a document whose translations never
    // landed must not be committed as though it had.
    const after = await handle.adapter.executeQuery<{ n: number }>(
      'SELECT COUNT(*) AS n FROM "dc_pages"'
    );
    expect(after[0].n).toBe(before[0].n);
  });

  it("leaves a collection that is not localized writing to its own table", async () => {
    // The control: the split must not divert a write that has no companion.
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    current = await createTestNextly({
      adapter,
      collections: [
        defineCollection({
          slug: "notes",
          access: { create: () => true, read: () => true },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler = current.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    const result = await entries.createEntries(
      { collectionName: "notes", overrideAccess: true },
      [{ title: "plain" }]
    );

    expect(result.errors).toEqual([]);
    expect(result.successful).toBe(1);
    const rows = await current.adapter.executeQuery<{ title: string }>(
      'SELECT "title" FROM "dc_notes"'
    );
    expect(rows.map(r => r.title)).toEqual(["plain"]);
  });
});
