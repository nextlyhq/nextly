/**
 * Webhook-event AND version-capture completeness matrix for the PROGRAMMATIC
 * write paths.
 *
 * The interactive create/update/delete paths are covered by `capture-matrix`.
 * This grid enumerates the tx-API and batch write paths that plugins, importers,
 * and agents use — `createEntryInTransaction`, `updateEntryInTransaction`,
 * `createEntries`, `updateEntries`, and `publishAllLocales` — and asserts each
 * BOTH records its outbox event AND captures a durable version snapshot. It is
 * the loud-failure guard for the twin invariants "every write is an event" and
 * "every write is captured": a future write path added without recording, or
 * without capturing, fails a cell here rather than going silently dark.
 *
 * Recording is endpoint-gated in production; the test harness defaults the gate
 * open, so no endpoint registration is needed. Version counts are scoped to each
 * written entry's own id, so the shared `nextly_versions` table cannot leak a
 * count in from another case in the sequential run.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { NextlyError } from "../../../errors";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
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

// nextly_versions is a Drizzle-schema core table, so adapter.select returns
// camelCase property keys (scopeSlug/entryId), unlike raw dc_ tables.
interface VersionRow {
  scopeSlug: string;
  entryId: string;
}

const COLLECTION = "posts";

async function boot(
  dialect: TestDialect,
  localized: boolean
): Promise<TestNextly> {
  current = await createTestNextly({
    // Boot against each configured dialect (SQLite plus Postgres/MySQL when
    // their server URL is set), so the per-dialect SQL and JSON paths the write
    // methods use are all exercised, not just SQLite.
    dialect,
    collections: [
      defineCollection({
        slug: COLLECTION,
        localized,
        status: true,
        // Opt into version history so each write path's snapshot is asserted
        // alongside its event; capture is additive and does not change events.
        versions: true,
        fields: [text({ name: "title", localized })],
      }),
    ],
    // Localization config is harmless when the collection is not localized; the
    // localized publish cell needs it and the others ignore it.
    localization: { locales: ["en", "de"], defaultLocale: "en" },
  });
  return current;
}

/** Version snapshots recorded for one specific entry in this collection. */
async function versionsForEntry(
  t: TestNextly,
  entryId: string
): Promise<number> {
  const rows = await t.adapter.select<VersionRow>("nextly_versions");
  return rows.filter(r => r.scopeSlug === COLLECTION && r.entryId === entryId)
    .length;
}

/** Create the `_locales` companion through the production DDL path. */
async function migrate(t: TestNextly): Promise<void> {
  const spec = deriveCompanionSpec({
    slug: COLLECTION,
    fields: [{ name: "title", type: "text", localized: true }],
    dialect: t.adapter.dialect,
    defaultLocale: "en",
    collectionLocalized: true,
    // Defined in config, so the pipeline built this table.
    builtBy: "codeFirst",
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
  /**
   * Drive the write path under test and return the ids of every entry it
   * created or updated, so the version assertion scopes to exactly those rows.
   */
  run: (t: TestNextly, e: CollectionEntryService) => Promise<string[]>;
  /**
   * Minimum count required per event type. Cells assert the path emits at least
   * this many of each type. The assert type set is derived from the keys; a seed
   * step must never emit the SAME type being asserted, so counts stay clean.
   */
  atLeast: Record<string, number>;
  /**
   * Minimum version snapshots expected for EACH written entry. A create path
   * captures its one snapshot (1). An update path is seeded through the
   * interactive create (which captures 1) and then writes again, so the written
   * entry carries two (2).
   */
  minVersionsPerEntry: number;
}

const CASES: PathCase[] = [
  {
    label: "createEntryInTransaction records entry.created + captures version",
    localized: false,
    run: async (t, e) => {
      const res = await t.adapter.transaction(tx =>
        e.createEntryInTransaction(
          tx as never,
          { collectionName: COLLECTION, overrideAccess: true },
          { title: "a", status: "draft" }
        )
      );
      return [(res.data as { id: string }).id];
    },
    atLeast: { "entry.created": 1 },
    minVersionsPerEntry: 1,
  },
  {
    label:
      "createEntryInTransaction as published records entry.published + captures version",
    localized: false,
    run: async (t, e) => {
      const res = await t.adapter.transaction(tx =>
        e.createEntryInTransaction(
          tx as never,
          { collectionName: COLLECTION, overrideAccess: true },
          { title: "a", status: "published" }
        )
      );
      return [(res.data as { id: string }).id];
    },
    // A create landing directly on published is a create AND a publish.
    atLeast: { "entry.created": 1, "entry.published": 1 },
    minVersionsPerEntry: 1,
  },
  {
    label:
      "createEntries as published records entry.published per item + captures version",
    localized: false,
    run: async (_t, e) => {
      const res = await e.createEntries(
        { collectionName: COLLECTION, overrideAccess: true },
        [
          { title: "a", status: "published" },
          { title: "b", status: "published" },
        ]
      );
      return res.ids;
    },
    atLeast: { "entry.created": 2, "entry.published": 2 },
    minVersionsPerEntry: 1,
  },
  {
    label: "updateEntryInTransaction records entry.updated + captures version",
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
      return [id];
    },
    atLeast: { "entry.updated": 1 },
    minVersionsPerEntry: 2,
  },
  {
    label: "createEntries records entry.created per item + captures version",
    localized: false,
    run: async (_t, e) => {
      const res = await e.createEntries(
        { collectionName: COLLECTION, overrideAccess: true },
        [
          { title: "a", status: "draft" },
          { title: "b", status: "draft" },
        ]
      );
      return res.ids;
    },
    atLeast: { "entry.created": 2 },
    minVersionsPerEntry: 1,
  },
  {
    label: "updateEntries records entry.updated per item + captures version",
    localized: false,
    run: async (t, e) => {
      const id1 = await seed(t, { title: "a", status: "draft" });
      const id2 = await seed(t, { title: "b", status: "draft" });
      await e.updateEntries({ collectionName: COLLECTION }, [
        { id: id1, data: { title: "a2" } },
        { id: id2, data: { title: "b2" } },
      ]);
      return [id1, id2];
    },
    atLeast: { "entry.updated": 2 },
    minVersionsPerEntry: 2,
  },
  {
    label:
      "publishAllLocales records entry.updated + entry.published + captures version",
    localized: true,
    run: async (t, e) => {
      const id = await seed(t, { title: "a", status: "draft" });
      await e.publishAllLocales({
        collectionName: COLLECTION,
        entryId: id,
        overrideAccess: true,
      });
      return [id];
    },
    // A draft going live across locales is both a content update and a publish.
    atLeast: { "entry.updated": 1, "entry.published": 1 },
    minVersionsPerEntry: 2,
  },
];

describe.each(getConfiguredTestDialects())(
  "webhook write-path event matrix — programmatic writes (%s, integration)",
  dialect => {
    it.each(CASES)("$label", async pathCase => {
      const t = await boot(dialect, pathCase.localized);
      if (pathCase.localized) await migrate(t);
      const e = entriesOf(t);

      const writtenIds = await pathCase.run(t, e);

      const rows = await t.adapter.select<EventRow>("nextly_events");
      for (const [type, min] of Object.entries(pathCase.atLeast)) {
        const count = rows.filter(r => r.type === type).length;
        expect(
          count,
          `${pathCase.label}: expected >=${min} ${type}`
        ).toBeGreaterThanOrEqual(min);
      }

      // Every write path must also leave a durable version behind. Scoped to each
      // written entry's own id so the shared nextly_versions table cannot leak a
      // count in from a sibling case in the sequential run.
      expect(writtenIds.length).toBeGreaterThan(0);
      for (const id of writtenIds) {
        const versions = await versionsForEntry(t, id);
        expect(
          versions,
          `${pathCase.label}: expected >=${pathCase.minVersionsPerEntry} versions for entry ${id}`
        ).toBeGreaterThanOrEqual(pathCase.minVersionsPerEntry);
      }
    });
  }
);
