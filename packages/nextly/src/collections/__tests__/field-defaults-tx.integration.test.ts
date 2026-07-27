/**
 * Defaults on the transactional create path.
 *
 * `createEntryInTransaction` builds its insert payload straight from the write
 * data, without the JSON serialization pass the pooled create runs. A default
 * that is an object or an array therefore reaches the driver as a live value
 * rather than as JSON text, which each dialect handles differently — so the
 * path a default arrives on has to be exercised, not just the value.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, json, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";
import type { CollectionsHandler } from "../../services/collections-handler";
import type { CollectionEntryService } from "../../services/collections/collection-entry-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const OBJECT_DEFAULT = { a: 1, nested: { b: [1, 2] } };

describe("field defaults on a transactional create (integration)", () => {
  it("stores an object default as JSON, not as a driver expression", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "txdefaults",
          fields: [
            text({ name: "title" }),
            json({ name: "settings", defaultValue: OBJECT_DEFAULT }),
          ],
        }),
      ],
    });

    const entries = current
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService() as CollectionEntryService;

    const created = await current.adapter.transaction(tx =>
      entries.createEntryInTransaction(
        tx as never,
        { collectionName: "txdefaults", overrideAccess: true },
        { title: "T" }
      )
    );

    const id = (created as { data?: { id?: unknown } }).data?.id;
    expect(typeof id, JSON.stringify(created)).toBe("string");

    const read = await entries.getEntry({
      collectionName: "txdefaults",
      entryId: String(id),
      overrideAccess: true,
    });
    const data = ((read as { data?: unknown }).data ?? {}) as Record<
      string,
      unknown
    >;
    expect(data.settings).toEqual(OBJECT_DEFAULT);
  });

  it("encodes a scalar json default as a json document", async () => {
    // A JSON column stores a document: the bare string `enabled` is not valid
    // JSON, so a JSONB insert rejects it while `"enabled"` is accepted.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "txscalar",
          fields: [
            text({ name: "title" }),
            json({ name: "mode", defaultValue: "enabled" }),
          ],
        }),
      ],
    });

    const entries = current
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService() as CollectionEntryService;

    const created = await current.adapter.transaction(tx =>
      entries.createEntryInTransaction(
        tx as never,
        { collectionName: "txscalar", overrideAccess: true },
        { title: "T" }
      )
    );
    const id = (created as { data?: { id?: unknown } }).data?.id;
    expect(typeof id, JSON.stringify(created)).toBe("string");

    const read = await entries.getEntry({
      collectionName: "txscalar",
      entryId: String(id),
      overrideAccess: true,
    });
    const data = ((read as { data?: unknown }).data ?? {}) as Record<
      string,
      unknown
    >;
    expect(data.mode).toBe("enabled");
  });

  it("applies defaults on a localized collection", async () => {
    // A localized collection is the only case that reaches the companion
    // lookup, so without this the whole branch went unexercised — including
    // which method the driver handle actually exposes, which differs between
    // better-sqlite3 and the pg/mysql2 handles.
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: "txlocalized",
          localized: true,
          fields: [
            // Non-translatable, so this exercises the companion lookup without
            // running into the separate, pre-existing gap that transactional
            // creates have no companion-write step for translatable values.
            text({ name: "title", localized: false }),
            text({
              name: "subtitle",
              localized: false,
              defaultValue: "from-default",
            }),
          ],
        }),
      ],
    });

    const entries = current
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService() as CollectionEntryService;

    const created = await current.adapter.transaction(tx =>
      entries.createEntryInTransaction(
        tx as never,
        { collectionName: "txlocalized", overrideAccess: true },
        { title: "T" }
      )
    );
    const id = (created as { data?: { id?: unknown } }).data?.id;
    expect(typeof id, JSON.stringify(created)).toBe("string");

    const read = await entries.getEntry({
      collectionName: "txlocalized",
      entryId: String(id),
      overrideAccess: true,
    });
    const data = ((read as { data?: unknown }).data ?? {}) as Record<
      string,
      unknown
    >;
    expect(data.subtitle).toBe("from-default");
  });
});
