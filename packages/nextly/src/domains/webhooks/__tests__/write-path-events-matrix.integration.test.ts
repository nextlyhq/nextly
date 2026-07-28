/**
 * Webhook-event completeness matrix for the PROGRAMMATIC write paths.
 *
 * The interactive create/update/delete paths are covered by `capture-matrix`.
 * This grid enumerates the tx-API and batch write paths that plugins, importers,
 * and agents use — `createEntryInTransaction`, `updateEntryInTransaction`,
 * `createEntries`, `updateEntries`, and `publishAllLocales` — and asserts each
 * records its outbox event. It is the loud-failure guard for the invariant
 * "every write is an event": a future write path added without recording fails
 * a cell here rather than going silently dark.
 *
 * Recording is endpoint-gated in production; the test harness defaults the gate
 * open, so no endpoint registration is needed.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { NextlyError } from "../../../errors";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { deriveCompanionSpec } from "../../i18n/migration/derive-companion-spec";
import { buildCompanionCreateOnlySql } from "../../i18n/migration/generate-up";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface EventRow {
  type: string;
}

const COLLECTION = "posts";

async function boot(localized: boolean): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: COLLECTION,
        localized,
        status: true,
        fields: [text({ name: "title", localized })],
      }),
    ],
    // Localization config is harmless when the collection is not localized; the
    // localized publish cell needs it and the others ignore it.
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

/** Create the `_locales` companion through the production DDL path. */
async function migrate(t: TestNextly): Promise<void> {
  const spec = deriveCompanionSpec({
    slug: COLLECTION,
    fields: [{ name: "title", type: "text", localized: true }],
    dialect: t.adapter.dialect,
    defaultLocale: "en",
    collectionLocalized: true,
    status: true,
  });
  if (!spec) {
    throw NextlyError.internal({
      logContext: { reason: "missing-companion-spec", collection: COLLECTION },
    });
  }
  if (await t.adapter.tableExists(spec.companionTable)) return;
  const adapter = t.adapter as unknown as {
    executeQuery: (sql: string) => Promise<unknown>;
  };
  await adapter.executeQuery(buildCompanionCreateOnlySql(spec));
}

function entriesOf(t: TestNextly): CollectionEntryService {
  return t
    .getService<CollectionsHandler>("collectionsHandler")
    .getEntryService() as CollectionEntryService;
}

/** Run a create through the interactive path purely to seed a row to update. */
async function seed(
  t: TestNextly,
  data: Record<string, unknown>
): Promise<string> {
  const created = await t
    .getService<CollectionsHandler>("collectionsHandler")
    .createEntry({ collectionName: COLLECTION, overrideAccess: true }, data);
  return (created.data as { id: string }).id;
}

interface PathCase {
  label: string;
  localized: boolean;
  /** Drive the write path under test. */
  run: (t: TestNextly, e: CollectionEntryService) => Promise<void>;
  /**
   * Minimum count required per event type. Cells assert the path emits at least
   * this many of each type. The assert type set is derived from the keys; a seed
   * step must never emit the SAME type being asserted, so counts stay clean.
   */
  atLeast: Record<string, number>;
}

const CASES: PathCase[] = [
  {
    label: "createEntryInTransaction records entry.created",
    localized: false,
    run: async (t, e) => {
      await t.adapter.transaction(tx =>
        e.createEntryInTransaction(
          tx as never,
          { collectionName: COLLECTION, overrideAccess: true },
          { title: "a", status: "draft" }
        )
      );
    },
    atLeast: { "entry.created": 1 },
  },
  {
    label: "createEntryInTransaction as published records entry.published",
    localized: false,
    run: async (t, e) => {
      await t.adapter.transaction(tx =>
        e.createEntryInTransaction(
          tx as never,
          { collectionName: COLLECTION, overrideAccess: true },
          { title: "a", status: "published" }
        )
      );
    },
    // A create landing directly on published is a create AND a publish.
    atLeast: { "entry.created": 1, "entry.published": 1 },
  },
  {
    label: "createEntries as published records entry.published per item",
    localized: false,
    run: async (_t, e) => {
      await e.createEntries({ collectionName: COLLECTION, overrideAccess: true }, [
        { title: "a", status: "published" },
        { title: "b", status: "published" },
      ]);
    },
    atLeast: { "entry.created": 2, "entry.published": 2 },
  },
  {
    label: "updateEntryInTransaction records entry.updated",
    localized: false,
    run: async (t, e) => {
      const id = await seed(t, { title: "a", status: "draft" });
      await t.adapter.transaction(tx =>
        e.updateEntryInTransaction(
          tx as never,
          { collectionName: COLLECTION, entryId: id, overrideAccess: true },
          { title: "b" }
        )
      );
    },
    atLeast: { "entry.updated": 1 },
  },
  {
    label: "createEntries records entry.created per item",
    localized: false,
    run: async (_t, e) => {
      await e.createEntries({ collectionName: COLLECTION, overrideAccess: true }, [
        { title: "a", status: "draft" },
        { title: "b", status: "draft" },
      ]);
    },
    atLeast: { "entry.created": 2 },
  },
  {
    label: "updateEntries records entry.updated per item",
    localized: false,
    run: async (t, e) => {
      const id1 = await seed(t, { title: "a", status: "draft" });
      const id2 = await seed(t, { title: "b", status: "draft" });
      await e.updateEntries({ collectionName: COLLECTION }, [
        { id: id1, data: { title: "a2" } },
        { id: id2, data: { title: "b2" } },
      ]);
    },
    atLeast: { "entry.updated": 2 },
  },
  {
    label: "publishAllLocales records entry.updated + entry.published",
    localized: true,
    run: async (t, e) => {
      const id = await seed(t, { title: "a", status: "draft" });
      await e.publishAllLocales({
        collectionName: COLLECTION,
        entryId: id,
        overrideAccess: true,
      });
    },
    // A draft going live across locales is both a content update and a publish.
    atLeast: { "entry.updated": 1, "entry.published": 1 },
  },
];

describe("webhook write-path event matrix — programmatic writes (integration)", () => {
  it.each(CASES)("$label", async pathCase => {
    const t = await boot(pathCase.localized);
    if (pathCase.localized) await migrate(t);
    const e = entriesOf(t);

    await pathCase.run(t, e);

    const rows = await t.adapter.select<EventRow>("nextly_events");
    for (const [type, min] of Object.entries(pathCase.atLeast)) {
      const count = rows.filter(r => r.type === type).length;
      expect(count, `${pathCase.label}: expected >=${min} ${type}`).toBeGreaterThanOrEqual(
        min
      );
    }
  });
});
