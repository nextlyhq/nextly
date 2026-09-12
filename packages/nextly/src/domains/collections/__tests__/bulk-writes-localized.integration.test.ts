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

import { defineCollection, number, richText, text } from "../../../config";
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

    // A second language for the same entry. Without one, every assertion below
    // is satisfied by a write that ignores its locale entirely: one row cannot
    // show whether the upsert matched on the language or merely on the parent,
    // nor whether the read-back filtered by it.
    await handle.adapter.executeQuery(
      `INSERT INTO "dc_pages_locales" ("_parent", "_locale", "title", "kind") ` +
        `VALUES ('${created._parent}', 'de', 'erste', 'eins')`
    );

    const updated = await entries.updateEntries(
      { collectionName: "pages", overrideAccess: true },
      [{ id: created._parent, data: { kind: "edited" } }]
    );

    expect(updated.errors).toEqual([]);
    expect(updated.successful).toBe(1);

    const rows = await companionRows(handle);
    expect(rows).toHaveLength(2);
    const byLocale = Object.fromEntries(rows.map(r => [r._locale, r]));
    // The patched field moved in the write's language; the one the patch did
    // not name stayed.
    expect(byLocale.en.kind).toBe("edited");
    expect(byLocale.en.title).toBe("first");
    // And the other language is untouched: this write named one locale, and a
    // write that matched only on the parent would have overwritten this row.
    expect(byLocale.de.kind).toBe("eins");
    expect(byLocale.de.title).toBe("erste");
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
        ) as {
          resource?: { id?: string; locale?: string };
          data?: Record<string, unknown>;
        };
        return {
          id: envelope.resource?.id,
          locale: envelope.resource?.locale,
          doc: envelope.data ?? {},
        };
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

    // Every event names the language it describes: a receiver reads the
    // locale from the resource, and a localized write that omits it is
    // delivered as belonging to no translation in particular.
    expect(documents.map(d => d.locale)).toEqual(["en", "en"]);

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
      .catch((error: unknown) => ({
        successful: 0,
        errors: [{ error: String((error as Error)?.message ?? error) }],
      }));

    expect(result.successful).toBe(0);
    // The batch aborted as a write-integrity failure, which is the only
    // reading under which the row count below means anything. This exact
    // message is emitted ONLY on the integrity-abort path; the same count is
    // produced by the MAIN insert failing first — a refusal that never wrote a
    // parent, reported as an ordinary per-item error — so the message is what
    // separates a rollback from a write that never happened.
    expect(JSON.stringify(result.errors)).toContain(
      "could not be completed and was rolled back"
    );
    // The parent row did not survive: a document whose translations never
    // landed must not be committed as though it had.
    const after = await handle.adapter.executeQuery<{ n: number }>(
      'SELECT COUNT(*) AS n FROM "dc_pages"'
    );
    expect(after[0].n).toBe(before[0].n);
  });

  it("rolls a batch update back when the companion write fails", async () => {
    // The create's twin. A companion write that fails AFTER the main row is
    // updated must abort the batch rather than report a soft per-item failure:
    // with `stopOnError` false the transaction would otherwise commit a main
    // row whose translation never landed, reporting the item as failed.
    //
    // The failure is injected at the WRITE rather than by dropping the table,
    // so the prior-translation read still succeeds and the upsert is the only
    // thing that can fail — which is what this pins.
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    current = await createTestNextly({
      adapter,
      collections: [
        defineCollection({
          slug: "mixed2",
          localized: true,
          access: {
            create: () => true,
            read: () => true,
            update: () => true,
          },
          fields: [text({ name: "title" }), number({ name: "rank" })],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const handle = current;
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    const created = await entries.createEntries(
      { collectionName: "mixed2", overrideAccess: true },
      [{ title: "before", rank: 1 }]
    );
    expect(created.errors).toEqual([]);
    const [row] = await handle.adapter.executeQuery<{ id: string }>(
      'SELECT "id" FROM "dc_mixed2" LIMIT 1'
    );
    await handle.adapter.executeQuery(
      `CREATE TRIGGER refuse_companion BEFORE INSERT ON "dc_mixed2_locales" ` +
        `BEGIN SELECT RAISE(ABORT, 'companion write refused'); END`
    );

    // `rank` is shared and lands on the main row; `title` is translatable and
    // goes to the companion the trigger refuses.
    const result = await entries
      .updateEntries({ collectionName: "mixed2", overrideAccess: true }, [
        { id: row.id, data: { title: "after", rank: 2 } },
      ])
      .catch((error: unknown) => ({
        successful: 0,
        errors: [{ error: String((error as Error)?.message ?? error) }],
      }));

    expect(result.successful).toBe(0);
    // The integrity-abort path, not a soft per-item failure: unmarked, the
    // trigger's error is reported per item and the transaction still commits.
    expect(JSON.stringify(result.errors)).toContain(
      "could not be completed and was rolled back"
    );
    // The main row's shared field did not survive the failed companion write.
    const after = await handle.adapter.executeQuery<{ rank: number }>(
      `SELECT "rank" FROM "dc_mixed2" WHERE "id" = '${row.id}'`
    );
    expect(after[0].rank).toBe(1);
  });

  it("leaves a collection that is not localized writing to its own table", async () => {
    // The control: the split must not divert a write that has no companion.
    //
    // Configured WITH localization, and the collection simply not localized.
    // Without it the split returns at its first statement — before the
    // companion lookup, before the readiness branch, before anything this
    // exercise is about — so the case would pass on any implementation. The
    // risk worth controlling is a plain collection inside a localized app,
    // which reaches the split and must still be left alone.
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
      localization: { locales: ["en", "de"], defaultLocale: "en" },
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

  it("stores a localized rich-text value the companion column can hold", async () => {
    // The headline case this change exists for, on the commonest translatable
    // field there is. A rich-text value arrives as an object and its column is
    // text-backed, so it has to be serialized BEFORE the split copies it into
    // the companion payload — otherwise the driver is handed an object to bind
    // and refuses it, and `createMany` fails every row exactly as it did
    // before any of this.
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    current = await createTestNextly({
      adapter,
      collections: [
        defineCollection({
          slug: "articles",
          localized: true,
          access: {
            create: () => true,
            read: () => true,
            update: () => true,
          },
          fields: [text({ name: "title" }), richText({ name: "body" })],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const handle = current;
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    const body = { root: { children: [{ type: "p", text: "hello" }] } };
    // The second row is what discriminates. An OBJECT is encoded the same way
    // by either route, because the SQLite adapter JSON-stringifies any object
    // on its way to the driver — so an object alone cannot tell a shaped write
    // from an unshaped one, and a test using only one would pass with the
    // shaping removed. A BARE STRING can tell them apart: the field's own
    // encoder makes it the JSON document `"plain"`, while the adapter's
    // sanitizer passes a string straight through as `plain`, which is not a
    // JSON document and which PostgreSQL and MySQL refuse for a json column.
    const result = await entries.createEntries(
      { collectionName: "articles", overrideAccess: true },
      [
        { title: "one", body },
        { title: "two", body: "plain" },
      ]
    );

    expect(result.errors).toEqual([]);
    expect(result.successful).toBe(2);

    // Stored in the companion, as text the column can actually hold.
    const rows = await handle.adapter.executeQuery<{
      title: string;
      body: unknown;
      _locale: string;
    }>(
      'SELECT "title", "body", "_locale" FROM "dc_articles_locales" ORDER BY "title"'
    );
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r._locale)).toEqual(["en", "en"]);
    expect(typeof rows[0].body).toBe("string");
    expect(JSON.parse(rows[0].body as string)).toEqual(body);
    // The discriminating one: a JSON document, not the bare characters.
    expect(rows[1].body).toBe('"plain"');
    expect(JSON.parse(rows[1].body as string)).toBe("plain");

    // And a batch UPDATE of the same field has the same requirement.
    const [created] = await handle.adapter.executeQuery<{ id: string }>(
      `SELECT "id" FROM "dc_articles" WHERE "id" = '${
        (
          await handle.adapter.executeQuery<{ _parent: string }>(
            `SELECT "_parent" FROM "dc_articles_locales" WHERE "title" = 'one'`
          )
        )[0]._parent
      }'`
    );
    const edited = { root: { children: [{ type: "p", text: "edited" }] } };
    const updated = await entries.updateEntries(
      { collectionName: "articles", overrideAccess: true },
      [{ id: created.id, data: { body: edited } }]
    );
    expect(updated.errors).toEqual([]);
    const after = await handle.adapter.executeQuery<{ body: unknown }>(
      `SELECT "body" FROM "dc_articles_locales" WHERE "_parent" = '${created.id}'`
    );
    expect(JSON.parse(after[0].body as string)).toEqual(edited);
  });

  it("reports the prior translation as what changed, not the untranslated row", async () => {
    // The main table of a migrated localized collection holds no translatable
    // columns, so a `previous` built from it alone describes none of the values
    // the patch is about: a receiver diffing it sees every translation appear
    // from nothing, and the old value of the field that did change is lost.
    const handle = await boot();
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    await entries.createEntries(
      { collectionName: "pages", overrideAccess: true },
      [{ title: "first", kind: "one" }]
    );
    const [created] = await companionRows(handle);

    await entries.updateEntries(
      { collectionName: "pages", overrideAccess: true },
      [{ id: created._parent, data: { kind: "edited" } }]
    );

    const events = await handle.adapter.select<{
      type: string;
      payload: unknown;
    }>("nextly_events");
    const updates = events
      .filter(e => e.type === "entry.updated")
      .map(e => {
        const envelope = (
          typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload
        ) as {
          resource?: { id?: string };
          previous?: Record<string, unknown> | null;
        };
        return { id: envelope.resource?.id, previous: envelope.previous ?? {} };
      })
      .filter(u => u.id === created._parent);

    expect(updates).toHaveLength(1);
    // The value this patch replaced, as it was.
    expect(updates[0].previous).toHaveProperty("kind", "one");
    // And a translation the patch never named still describes the prior state.
    expect(updates[0].previous).toHaveProperty("title", "first");
  });
});

/**
 * A localized collection whose status is kept per language: the companion row
 * carries `_status`, so the main row and a translation can disagree about
 * whether that language is published.
 */
async function bootPerLocaleStatus(
  access: Record<string, () => boolean> = {}
): Promise<TestNextly> {
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    memory: true,
  } as Parameters<typeof createAdapter>[0]);
  current = await createTestNextly({
    adapter,
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        status: true,
        access: {
          create: () => true,
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: () => true,
          ...access,
        },
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

describe("a bulk write that moves a localized collection's published state", () => {
  it("refuses to publish a translation for a caller who cannot publish", async () => {
    // The state a reconcile leaves: the main row is published while this
    // language's companion `_status` is still draft. Judged against the main
    // row alone the write reads `published -> published` — a no-op needing no
    // grant — while the companion write it authorizes publishes the
    // translation.
    const handle = await bootPerLocaleStatus({ publish: () => false });
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    const created = await entries.createEntries(
      { collectionName: "posts", overrideAccess: true },
      [{ title: "t", status: "published" }]
    );
    expect(created.successful).toBe(1);
    const [row] = await handle.adapter.executeQuery<{ _parent: string }>(
      'SELECT "_parent" FROM "dc_posts_locales" LIMIT 1'
    );
    await handle.adapter.executeQuery(
      `UPDATE "dc_posts_locales" SET "_status" = 'draft' WHERE "_parent" = '${row._parent}'`
    );

    const result = await entries
      .updateEntries({ collectionName: "posts", user: { id: "editor" } }, [
        { id: row._parent, data: { status: "published" } },
      ])
      .catch(() => ({ successful: 0, failed: 1, errors: [{}] }));

    expect(result.successful).toBe(0);
    // The translation was not published behind the gate's back.
    const after = await handle.adapter.executeQuery<{ _status: string }>(
      `SELECT "_status" FROM "dc_posts_locales" WHERE "_parent" = '${row._parent}'`
    );
    expect(after[0]._status).toBe("draft");
  });

  it("lets the same write through for a caller who can publish", async () => {
    // The control: the gate is enforcing a missing permission, not refusing
    // every localized status write.
    const handle = await bootPerLocaleStatus();
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    await entries.createEntries(
      { collectionName: "posts", overrideAccess: true },
      [{ title: "t", status: "published" }]
    );
    const [row] = await handle.adapter.executeQuery<{ _parent: string }>(
      'SELECT "_parent" FROM "dc_posts_locales" LIMIT 1'
    );
    await handle.adapter.executeQuery(
      `UPDATE "dc_posts_locales" SET "_status" = 'draft' WHERE "_parent" = '${row._parent}'`
    );

    const result = await entries.updateEntries(
      { collectionName: "posts", user: { id: "editor" } },
      [{ id: row._parent, data: { status: "published" } }]
    );

    expect(result.errors).toEqual([]);
    expect(result.successful).toBe(1);
    const after = await handle.adapter.executeQuery<{ _status: string }>(
      `SELECT "_status" FROM "dc_posts_locales" WHERE "_parent" = '${row._parent}'`
    );
    expect(after[0]._status).toBe("published");
  });

  it("announces no publication when a content-only patch leaves the translation a draft", async () => {
    // The main row is published while this language's companion `_status` is
    // still draft — the state a reconcile leaves — and the patch names no
    // status at all. Nothing publishes the translation, so nothing may say it
    // did: the status this write reports must come from the same row its prior
    // status came from.
    const handle = await bootPerLocaleStatus();
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    await entries.createEntries(
      { collectionName: "posts", overrideAccess: true },
      [{ title: "t", status: "published" }]
    );
    const [row] = await handle.adapter.executeQuery<{ _parent: string }>(
      'SELECT "_parent" FROM "dc_posts_locales" LIMIT 1'
    );
    await handle.adapter.executeQuery(
      `UPDATE "dc_posts_locales" SET "_status" = 'draft' WHERE "_parent" = '${row._parent}'`
    );
    const before = await handle.adapter.select<{ type: string }>(
      "nextly_events"
    );

    // Translated content only. No status named anywhere in the patch.
    const result = await entries.updateEntries(
      { collectionName: "posts", overrideAccess: true },
      [{ id: row._parent, data: { title: "neu" } }]
    );
    expect(result.errors).toEqual([]);
    expect(result.successful).toBe(1);

    const after = await handle.adapter.select<{
      type: string;
      payload: unknown;
    }>("nextly_events");
    const added = after.slice(before.length);
    // No lifecycle event: this write moved no publication state.
    expect(added.map(e => e.type).sort()).toEqual(["entry.updated"]);

    // And what it recorded describes a draft translation, not a published one.
    const envelope = (
      typeof added[0].payload === "string"
        ? JSON.parse(added[0].payload)
        : added[0].payload
    ) as { data?: Record<string, unknown> };
    expect(envelope.data?.status).toBe("draft");

    // The companion row is still a draft, which is what makes the above right.
    const companion = await handle.adapter.executeQuery<{ _status: string }>(
      `SELECT "_status" FROM "dc_posts_locales" WHERE "_parent" = '${row._parent}'`
    );
    expect(companion[0]._status).toBe("draft");
  });

  it("still announces a main-row publication when the translation was already published", async () => {
    // The mirror of the case above, and the one a single collapsed event gets
    // wrong in the other direction. The main row really does move draft ->
    // published — the entry becomes publicly visible — while this locale's
    // companion was published already, so the companion move is a no-op.
    // Reading both ends from the translation would read published ->
    // published and announce nothing at all.
    const handle = await bootPerLocaleStatus();
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    await entries.createEntries(
      { collectionName: "posts", overrideAccess: true },
      [{ title: "t", status: "draft" }]
    );
    const [row] = await handle.adapter.executeQuery<{ _parent: string }>(
      'SELECT "_parent" FROM "dc_posts_locales" LIMIT 1'
    );
    await handle.adapter.executeQuery(
      `UPDATE "dc_posts_locales" SET "_status" = 'published' WHERE "_parent" = '${row._parent}'`
    );
    const before = await handle.adapter.select<{ type: string }>(
      "nextly_events"
    );

    const result = await entries.updateEntries(
      { collectionName: "posts", overrideAccess: true },
      [{ id: row._parent, data: { status: "published" } }]
    );
    expect(result.errors).toEqual([]);

    const after = await handle.adapter.select<{ type: string }>(
      "nextly_events"
    );
    const added = after.slice(before.length).map(e => e.type);
    // The entry became publicly visible, and the lifecycle says so.
    expect(added).toContain("entry.published");
    expect(added).toContain("entry.status_changed");
  });

  it("reports a translation created by the write as the draft it is", async () => {
    // A locale with no companion row yet, patched with content only. The
    // upsert creates the row, and `_status` lands on its column default — so
    // the translation this write just made is a draft. Reporting the main
    // row's status instead tells receivers a brand-new translation is already
    // published.
    const handle = await bootPerLocaleStatus();
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    await entries.createEntries(
      { collectionName: "posts", overrideAccess: true },
      [{ title: "t", status: "published" }]
    );
    const [row] = await handle.adapter.executeQuery<{ _parent: string }>(
      'SELECT "_parent" FROM "dc_posts_locales" LIMIT 1'
    );
    // The locale goes back to having no row at all, which is the state a
    // never-translated language is in.
    await handle.adapter.executeQuery(
      `DELETE FROM "dc_posts_locales" WHERE "_parent" = '${row._parent}'`
    );
    const before = await handle.adapter.select<{ type: string }>(
      "nextly_events"
    );

    const result = await entries.updateEntries(
      { collectionName: "posts", overrideAccess: true },
      [{ id: row._parent, data: { title: "neu" } }]
    );
    expect(result.errors).toEqual([]);

    const after = await handle.adapter.select<{
      type: string;
      payload: unknown;
    }>("nextly_events");
    const updates = after
      .slice(before.length)
      .filter(e => e.type === "entry.updated");
    expect(updates).toHaveLength(1);
    const envelope = (
      typeof updates[0].payload === "string"
        ? JSON.parse(updates[0].payload)
        : updates[0].payload
    ) as { data?: Record<string, unknown> };
    expect(envelope.data?.status).toBe("draft");
    // And that is what the row the upsert created actually holds.
    const companion = await handle.adapter.executeQuery<{ _status: string }>(
      `SELECT "_status" FROM "dc_posts_locales" WHERE "_parent" = '${row._parent}'`
    );
    expect(companion[0]._status).toBe("draft");
  });

  it("names the language on every event a localized create derives", async () => {
    // A create landing on `published` emits a lifecycle event beside
    // `entry.created`. A receiver reads the language from the resource, so one
    // event carrying it and its siblings not leaves them describing no
    // translation in particular — and disagreeing about the same write.
    const handle = await bootPerLocaleStatus();
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    await entries.createEntries(
      { collectionName: "posts", overrideAccess: true },
      [{ title: "t", status: "published" }]
    );

    const events = await handle.adapter.select<{
      type: string;
      payload: unknown;
    }>("nextly_events");
    const locales = events
      .filter(e => e.type === "entry.created" || e.type === "entry.published")
      .map(e => {
        const envelope = (
          typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload
        ) as { resource?: { locale?: string } };
        return { type: e.type, locale: envelope.resource?.locale };
      });

    // Both events exist, and both name the language the values went into.
    expect(locales.map(l => l.type).sort()).toEqual([
      "entry.created",
      "entry.published",
    ]);
    expect(locales.every(l => l.locale === "en")).toBe(true);
  });

  it("writes nothing to the main row when the prior translation cannot be read", async () => {
    // A patch naming only a SHARED field writes no companion row at all, so the
    // companion-write guard never runs — but the prior translation still has to
    // be read, to say what this write changed. Read AFTER the main-table UPDATE,
    // a failure there leaves a committed row with no version and no event while
    // the item is reported as failed. Read before it, there is nothing to roll
    // back. `rank` is a number, which is shared rather than translatable, so
    // this patch reaches the read and nothing else.
    process.env.DB_DIALECT = "sqlite";
    const adapter = await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0]);
    current = await createTestNextly({
      adapter,
      collections: [
        defineCollection({
          slug: "mixed",
          localized: true,
          access: {
            create: () => true,
            read: () => true,
            update: () => true,
          },
          fields: [text({ name: "title" }), number({ name: "rank" })],
        }),
      ],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
    });
    const handle = current;
    const handler = handle.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;

    const created = await entries.createEntries(
      { collectionName: "mixed", overrideAccess: true },
      [{ title: "t", rank: 1 }]
    );
    expect(created.errors).toEqual([]);
    const [row] = await handle.adapter.executeQuery<{
      id: string;
      rank: number;
    }>('SELECT "id", "rank" FROM "dc_mixed" LIMIT 1');
    // The shared field really is on the main table, so the patch below names
    // nothing translatable.
    expect(row.rank).toBe(1);

    // Schema drift under a warm readiness verdict, which is the shape this
    // guards: the split still routes to the companion, and the read fails.
    await handle.adapter.executeQuery('DROP TABLE "dc_mixed_locales"');

    const result = await entries
      .updateEntries({ collectionName: "mixed", overrideAccess: true }, [
        { id: row.id, data: { rank: 2 } },
      ])
      .catch(() => ({ successful: 0, failed: 1, errors: [{}] }));

    expect(result.successful).toBe(0);
    // The shared field the patch named did not land.
    const after = await handle.adapter.executeQuery<{ rank: number }>(
      `SELECT "rank" FROM "dc_mixed" WHERE "id" = '${row.id}'`
    );
    expect(after[0].rank).toBe(1);
  });
});
