/**
 * The SQLite registries' timestamps: written in seconds, and rows an earlier release wrote in
 * milliseconds repaired, on a real SQLite database.
 *
 * - A registry row a migration writes holds seconds.
 * - A database holding millisecond rows (as every migration file generated before this writes
 *   them, each time it is applied) is repaired: those values become seconds, a row already in
 *   seconds is left as it is, and a second run changes nothing.
 * - Archived translations marked unresolved while their owner's row read as created far in the
 *   future go back to unknown for the corrected address alone, and the labelling then gives them
 *   their owner's kind.
 * - `nextly migrate`'s registry phase ends with the repair.
 * - A start repairs once, and a later start sends no statement for it.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { recordStatements } from "../../__tests__/helpers/record-statements";
import { installRegistryResolver } from "../../cli/utils/registry-resolver";
import { shutdownServices } from "../../di/register";
import { resolveRegistryTableName } from "../../domains/field-groups/storage/resolve-storage-names";
import { labelLegacyArchiveRows } from "../../domains/i18n/migration/label-legacy-archive-rows";
import { ensureSchemaEventsTable } from "../../domains/schema/events/schema-events-ddl";
import { reconcileMigrationMetadata } from "../../domains/schema/migrate/reconcile-metadata";
import {
  buildCollectionMetadataUpsert,
  buildComponentMetadataUpsert,
  buildSingleMetadataUpsert,
} from "../../domains/schema/ui-schema/metadata-sql";
import { runPostInitTasks } from "../../init/post-init-tasks";
import { createTestNextly } from "../../plugins/test-nextly";
import { getI18nArchiveDdl } from "../../schemas/nextly-i18n-archive/ddl";
import { createAdapter } from "../factory";
import { repairSqliteRegistryTimestamps } from "../repair-sqlite-registry-timestamps";
import { TIMESTAMP_REPAIR_META_KEY } from "../repair-sqlite-timestamps";

const SECONDS = "CAST(strftime('%s','now') AS INTEGER)";
const silent = { info: () => {}, warn: () => {}, debug: () => {} };

/** A registry-row statement as a migration file generated before this release holds it. */
const asAnOlderFileWroteIt = (statement: string): string =>
  statement.replaceAll(" * 1000", "").replaceAll(SECONDS, `${SECONDS} * 1000`);

/** The same statement writing seconds, whatever the builder writes. */
const inSeconds = (statement: string): string =>
  statement.replaceAll(" * 1000", "");

const entity = (slug: string) =>
  ({
    slug,
    labels: { singular: slug, plural: `${slug}s` },
    label: slug,
    fields: [{ name: "title", type: "text" }],
  }) as never;

describe("the SQLite registries' timestamps", () => {
  let dir: string;
  let url: string;
  let adapter: DrizzleAdapter;
  let fieldGroups: string;

  const adapterFor = (): Promise<DrizzleAdapter> =>
    createAdapter({ type: "sqlite", url } as Parameters<
      typeof createAdapter
    >[0]) as Promise<DrizzleAdapter>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-rsrt-"));
    url = `file:${join(dir, "rsrt.db")}`;
    // The core tables and the registries, as a started app has them.
    await createTestNextly({ adapter: (await adapterFor()) as never });
    await shutdownServices();
    adapter = await adapterFor();
    installRegistryResolver(adapter);
    fieldGroups = await resolveRegistryTableName(adapter);
    for (const statement of getI18nArchiveDdl("sqlite")) {
      await adapter.executeQuery(statement);
    }
    await ensureSchemaEventsTable(adapter);
  }, 180_000);

  afterAll(async () => {
    await adapter?.disconnect().catch(() => {});
    await shutdownServices();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    for (const table of [
      "dynamic_collections",
      "dynamic_singles",
      fieldGroups,
    ]) {
      await adapter.executeQuery(
        `DELETE FROM "${table}" WHERE slug LIKE 'rsrt_%'`
      );
    }
    await adapter.executeQuery(`DELETE FROM "nextly_i18n_archive"`);
  });

  /** A row's two timestamps exactly as the database holds them. */
  async function stored(
    table: string,
    slug: string
  ): Promise<{ created_at: number; updated_at: number }> {
    const [row] = await adapter.executeQuery<{
      created_at: number;
      updated_at: number;
    }>(`SELECT created_at, updated_at FROM "${table}" WHERE slug = '${slug}'`);
    return row;
  }

  const nowInSeconds = () => Math.floor(Date.now() / 1000);
  /** Whether a stored value is this moment in seconds, give or take a slow test. */
  const isNowInSeconds = (value: number) =>
    Math.abs(value - nowInSeconds()) < 120;

  it("a registry row a migration writes holds seconds", async () => {
    await adapter.executeQuery(
      buildCollectionMetadataUpsert(entity("rsrt_new"), "sqlite")
    );
    await adapter.executeQuery(
      buildSingleMetadataUpsert(entity("rsrt_new_single"), "sqlite")
    );
    await adapter.executeQuery(
      buildComponentMetadataUpsert(entity("rsrt_new_group"), "sqlite")
    );
    for (const [table, slug] of [
      ["dynamic_collections", "rsrt_new"],
      ["dynamic_singles", "rsrt_new_single"],
      [fieldGroups, "rsrt_new_group"],
    ]) {
      const row = await stored(table, slug);
      expect(isNowInSeconds(row.created_at), `${table} created_at`).toBe(true);
      expect(isNowInSeconds(row.updated_at), `${table} updated_at`).toBe(true);
    }
  });

  /** One row of each registry as an older file wrote it, and a collection already in seconds. */
  async function seedOlderRows(): Promise<void> {
    await adapter.executeQuery(
      asAnOlderFileWroteIt(
        buildCollectionMetadataUpsert(entity("rsrt_old"), "sqlite")
      )
    );
    await adapter.executeQuery(
      asAnOlderFileWroteIt(
        buildSingleMetadataUpsert(entity("rsrt_old_single"), "sqlite")
      )
    );
    await adapter.executeQuery(
      asAnOlderFileWroteIt(
        buildComponentMetadataUpsert(entity("rsrt_old_group"), "sqlite")
      )
    );
    await adapter.executeQuery(
      inSeconds(buildCollectionMetadataUpsert(entity("rsrt_kept"), "sqlite"))
    );
  }

  it("repairs rows written in milliseconds, leaves seconds alone, and changes nothing a second time", async () => {
    await seedOlderRows();
    expect(
      (await stored("dynamic_collections", "rsrt_old")).created_at
    ).toBeGreaterThan(1e11);
    const kept = await stored("dynamic_collections", "rsrt_kept");

    const first = await repairSqliteRegistryTimestamps(adapter);
    expect(first.repaired).toBe(3);
    for (const [table, slug] of [
      ["dynamic_collections", "rsrt_old"],
      ["dynamic_singles", "rsrt_old_single"],
      [fieldGroups, "rsrt_old_group"],
    ]) {
      const row = await stored(table, slug);
      expect(isNowInSeconds(row.created_at), `${table} created_at`).toBe(true);
      expect(isNowInSeconds(row.updated_at), `${table} updated_at`).toBe(true);
    }
    expect(await stored("dynamic_collections", "rsrt_kept")).toEqual(kept);

    const before = await stored("dynamic_collections", "rsrt_old");
    const second = await repairSqliteRegistryTimestamps(adapter);
    expect(second.repaired).toBe(0);
    expect(await stored("dynamic_collections", "rsrt_old")).toEqual(before);
  });

  it("repairs a row whose update alone was written in milliseconds", async () => {
    // An older file's upsert over a row already there sets `updated_at` and keeps `created_at`.
    await adapter.executeQuery(
      inSeconds(buildCollectionMetadataUpsert(entity("rsrt_old"), "sqlite"))
    );
    await adapter.executeQuery(
      asAnOlderFileWroteIt(
        buildCollectionMetadataUpsert(entity("rsrt_old"), "sqlite")
      )
    );
    expect(
      (await stored("dynamic_collections", "rsrt_old")).updated_at
    ).toBeGreaterThan(1e11);
    await repairSqliteRegistryTimestamps(adapter);
    const row = await stored("dynamic_collections", "rsrt_old");
    expect(isNowInSeconds(row.updated_at)).toBe(true);
    expect(isNowInSeconds(row.created_at)).toBe(true);
  });

  it("gives the corrected address's unresolved archive rows back to the labelling, and no other's", async () => {
    await seedOlderRows();
    const archive = (collection: string, kind: string) =>
      adapter.executeQuery(
        `INSERT INTO "nextly_i18n_archive" ("collection", "entity_kind", "entry_id", "locale", "field", "value", "archived_at") VALUES ('${collection}', '${kind}', 'e1', 'fr', 'title', 'Bonjour', unixepoch() + 3600)`
      );
    // Marked unresolved while its owner's row read as created far in the future.
    await archive("rsrt_old", "unresolved");
    // Another address's unresolved rows, whose owner's row was never wrong.
    await archive("rsrt_kept", "unresolved");
    // An address no registry holds.
    await archive("rsrt_gone", "unresolved");
    const kinds = async () =>
      Object.fromEntries(
        (
          await adapter.executeQuery<{
            collection: string;
            entity_kind: string;
          }>(
            `SELECT collection, entity_kind FROM "nextly_i18n_archive" ORDER BY id`
          )
        ).map(row => [row.collection, row.entity_kind])
      );

    await repairSqliteRegistryTimestamps(adapter);
    expect(await kinds()).toEqual({
      rsrt_old: "unknown",
      rsrt_kept: "unresolved",
      rsrt_gone: "unresolved",
    });

    await labelLegacyArchiveRows(adapter as never);
    expect((await kinds()).rsrt_old).toBe("collection");
  });

  it("`nextly migrate`'s registry phase ends with the repair", async () => {
    await seedOlderRows();
    const migrations = mkdtempSync(join(tmpdir(), "nextly-rsrt-migrations-"));
    try {
      await reconcileMigrationMetadata({
        adapter,
        dialect: "sqlite",
        migrationsDir: migrations,
        logger: silent,
      });
    } finally {
      rmSync(migrations, { recursive: true, force: true });
    }
    expect(
      isNowInSeconds(
        (await stored("dynamic_collections", "rsrt_old")).created_at
      )
    ).toBe(true);
  });

  it("a start repairs once, and a later start sends no statement for it", async () => {
    await adapter.disconnect();
    const startAdapter = await adapterFor();
    await createTestNextly({ adapter: startAdapter as never });
    try {
      // The mark of an earlier start taken away: this one is the first on this release.
      await startAdapter.executeQuery(
        `DELETE FROM nextly_meta WHERE key = '${TIMESTAMP_REPAIR_META_KEY}'`
      );
      await startAdapter.executeQuery(
        asAnOlderFileWroteIt(
          buildCollectionMetadataUpsert(entity("rsrt_old"), "sqlite")
        )
      );
      await runPostInitTasks();
      const [row] = await startAdapter.executeQuery<{ created_at: number }>(
        `SELECT created_at FROM dynamic_collections WHERE slug = 'rsrt_old'`
      );
      expect(isNowInSeconds(row.created_at)).toBe(true);

      /** Every statement one later start's tasks send. */
      const laterStart = async (): Promise<string[]> => {
        const recorder = await recordStatements(startAdapter, "sqlite");
        try {
          await runPostInitTasks();
        } finally {
          recorder.uninstall();
        }
        return recorder.statements;
      };
      const second = await laterStart();
      const third = await laterStart();
      // The repair's own statements name the registries' timestamps in a write.
      const repairs = (statements: string[]) =>
        statements.filter(
          text =>
            /^\s*UPDATE/i.test(text) &&
            /created_at|updated_at/.test(text) &&
            /1000/.test(text)
        );
      expect(repairs(second)).toEqual([]);
      // Nor does it look for rows to repair: the line it reads above appears in no statement.
      expect(second.filter(text => text.includes("100000000000"))).toEqual([]);
      expect(second.length).toBe(third.length);
      // One read of the mark, as before this repair was added.
      const readsOfTheMark = (statements: string[]) =>
        statements.filter(
          text => /nextly_meta/.test(text) && /^\s*select/i.test(text)
        );
      expect(readsOfTheMark(second).length).toBe(readsOfTheMark(third).length);
    } finally {
      await shutdownServices();
      adapter = await adapterFor();
    }
  });
});
