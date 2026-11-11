/**
 * Every writer of registry rows stores the schema version in the same
 * transaction as its rows, on every dialect: failed just before its commit,
 * neither the rows nor the version change; committed, both do.
 *
 * The failure just before the commit is the version's own write failing: it
 * is the last statement each writer's transaction sends, so the test takes
 * the `nextly_meta` table away for the run and puts it back afterwards. A
 * writer that wrote its rows outside that transaction (on a pooled connection
 * of its own, say) keeps them when the version cannot be written, which is
 * the defect this suite exists to catch; the committed run of the same writer
 * is the control that shows the rows and the version are written at all.
 *
 * The writers, each through the code `nextly migrate`, `migrate:down`, a
 * Builder save or a plugin install runs:
 * - the registry phase of `nextly migrate` (`reconcileMigrationMetadata`),
 *   writing rows from the newest applied snapshot and naming its migration;
 * - a migration file's own registry row and the version statement after it
 *   (`schemaVersionStoreSql`), run by the migration runner;
 * - a migration's DOWN rolled back by `migrate:down` (`rollBackOne`);
 * - the Builder save's writes: a registry service's create of a Single and a
 *   field group, and the save's own update of a collection row, wrapped as
 *   the save wraps them (`writeRegistryRows`, `writeRegistryRowsWith`);
 * - the plugin lifecycle record an install writes.
 *
 * And a run stopped after a migration's first schema statement committed,
 * before its registry rows: on MySQL, where a schema statement commits, and
 * on PostgreSQL and SQLite with a file marked to run outside a transaction.
 * The stop is the next statement failing, which ends the run there as a
 * killed process would; the version is left as it was.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import {
  downDatabaseDeps,
  rollBackOne,
} from "../../../cli/commands/migrate-down";
import { installRegistryResolver } from "../../../cli/utils/registry-resolver";
import { createAdapter } from "../../../database/factory";
import { shutdownServices } from "../../../di/register";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { consoleLogger } from "../../../shared/types";
import { FieldGroupRegistryService } from "../../field-groups/services/field-group-registry-service";
import { resolveRegistryTableName } from "../../field-groups/storage/resolve-storage-names";
import { SingleRegistryService } from "../../singles/services/single-registry-service";
import { getSchemaEventsDdl } from "../events/schema-events-ddl";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import { generateMigration } from "../migrate-create/generate";
import { EMPTY_SNAPSHOT, writeSnapshot } from "../migrate-create/snapshot-io";
import { runMigrationStatements } from "../migrate/migration-transaction";
import { reconcileMigrationMetadata } from "../migrate/reconcile-metadata";
import { splitSqlStatements } from "../migrate/split-sql";
import { parseSqlSections } from "../migrate/sql-sections";
import { recordPluginLifecycle } from "../ownership/plugin-lifecycle-state";
import {
  readSchemaVersion,
  schemaVersionStoreSql,
  storeSchemaVersion,
  writeRegistryRows,
  writeRegistryRowsWith,
  type SchemaVersion,
} from "../schema-version";
import { buildCollectionMetadataUpsert } from "../ui-schema/metadata-sql";

const SEED = "20250101_000000_000_seed";
const MIGRATED = "20260101_000000_000_migrate_svw";
const OLDER = "20260102_000000_000_create_svw";
const NEWER = "20260201_000000_000_change_svw";

const silent = { info: () => {}, warn: () => {}, debug: () => {} };

describe.each(getConfiguredTestDialects())(
  "a registry writer's rows and the schema version (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;
    let adapter: DrizzleAdapter;
    let dir: string;

    const adapterFor = (): Promise<DrizzleAdapter> =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;

    beforeAll(async () => {
      if (dialect === "sqlite") {
        const sqliteDir = mkdtempSync(join(tmpdir(), "nextly-svw-"));
        url = `file:${join(sqliteDir, "svw.db")}`;
        drop = async () => rmSync(sqliteDir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_svw");
        url = scratch.url;
        drop = scratch.drop;
      }
      // The core tables, the registries and `nextly_meta` among them, as a
      // started app has them.
      await createTestNextly({ adapter: (await adapterFor()) as never });
      await shutdownServices();
      adapter = await adapterFor();
      installRegistryResolver(adapter);
      // The migration ledger, which `nextly migrate` creates beside them.
      if (!(await adapter.tableExists("nextly_schema_events"))) {
        for (const statement of getSchemaEventsDdl(dialect)) {
          await adapter.executeQuery(statement);
        }
      }
    }, 180_000);

    afterAll(async () => {
      await adapter?.disconnect().catch(() => {});
      await shutdownServices();
      await drop?.();
    });

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-svw-migrations-"));
      // A known version to compare against: a database migrated to SEED.
      await storeSchemaVersion(adapter.getDrizzle(), dialect, {
        wrote: true,
        migration: SEED,
      });
    });

    /** The stored version, which every case reads before and after. */
    async function version(): Promise<SchemaVersion | undefined> {
      const stored = await readSchemaVersion(adapter.getDrizzle(), dialect);
      return stored.present ? stored.version : undefined;
    }

    /** Whether a registry table holds a row for `slug`. */
    async function hasRow(table: string, slug: string): Promise<boolean> {
      const row = await adapter.selectOne(table, {
        where: { and: [{ column: "slug", op: "=", value: slug }] },
      });
      return row !== null;
    }

    /**
     * Run `write` with `nextly_meta` taken away, so the version's write, the
     * last statement of the writer's transaction, fails; then put it back.
     */
    async function failingAtTheVersion(write: () => Promise<unknown>) {
      await adapter.executeQuery(
        "ALTER TABLE nextly_meta RENAME TO nextly_meta_away"
      );
      try {
        await expect(write()).rejects.toBeDefined();
      } finally {
        await adapter.executeQuery(
          "ALTER TABLE nextly_meta_away RENAME TO nextly_meta"
        );
      }
    }

    /** An app migration recorded applied in the ledger. */
    async function recordApplied(base: string): Promise<void> {
      await new SchemaEventsRepository(
        adapter.getDrizzle(),
        dialect
      ).insertEvent({
        eventType: "file_apply",
        source: "cli-migrate",
        status: "applied",
        filename: `${base}.sql`,
        endedAt: new Date(),
      });
    }

    /** A Builder collection's declaration, as a manifest records it. */
    const builderCollection = (slug: string) => ({
      slug,
      labels: { singular: slug, plural: `${slug}s` },
      fields: [{ name: "headline", type: "text" }],
    });

    it("`nextly migrate`'s registry phase: rows and version together, naming the newest applied migration", async () => {
      const slug = `svw_migrate_${dialect.slice(0, 2)}`;
      await recordApplied(MIGRATED);
      await writeSnapshot(
        join(dir, "meta"),
        MIGRATED,
        EMPTY_SNAPSHOT,
        "",
        {},
        {
          collections: {
            [slug]: { source: "builder", settings: builderCollection(slug) },
          },
          singles: {},
          fieldGroups: {},
        }
      );
      const run = () =>
        reconcileMigrationMetadata({
          adapter,
          dialect,
          migrationsDir: dir,
          logger: silent,
        });

      const before = await version();
      await failingAtTheVersion(run);
      expect(await hasRow("dynamic_collections", slug)).toBe(false);
      expect(await version()).toEqual(before);

      const result = await run();
      expect(result.collectionsRegistered).toBe(1);
      expect(await hasRow("dynamic_collections", slug)).toBe(true);
      expect(await version()).toEqual({
        migration: MIGRATED,
        seq: (before?.seq ?? 0) + 1,
      });
    });

    it("a migration file's registry row and the version statement after it", async () => {
      const slug = `svw_file_${dialect.slice(0, 2)}`;
      const statements = [
        buildCollectionMetadataUpsert(
          builderCollection(slug) as never,
          dialect
        ),
        schemaVersionStoreSql(dialect),
      ];
      const run = () =>
        runMigrationStatements(adapter, statements, {
          source: `${NEWER}.sql`,
          transaction: true,
        });

      const before = await version();
      await failingAtTheVersion(run);
      expect(await hasRow("dynamic_collections", slug)).toBe(false);
      expect(await version()).toEqual(before);

      await run();
      expect(await hasRow("dynamic_collections", slug)).toBe(true);
      // The count moves; the migration is `nextly migrate`'s to name.
      expect(await version()).toEqual({
        migration: before?.migration ?? null,
        seq: (before?.seq ?? 0) + 1,
      });
    });

    it("`migrate:down`: the DOWN's registry row and the version, moved back to the newest migration still applied", async () => {
      const slug = `svw_down_${dialect.slice(0, 2)}`;
      await recordApplied(OLDER);
      await recordApplied(NEWER);
      await storeSchemaVersion(adapter.getDrizzle(), dialect, {
        wrote: false,
        migration: NEWER,
      });
      const deps = await downDatabaseDeps({ adapter, dialect });
      const statements = [
        buildCollectionMetadataUpsert(
          builderCollection(slug) as never,
          dialect
        ),
      ];
      const run = () =>
        rollBackOne(
          {
            filename: `${NEWER}.sql`,
            downSql: statements.join("\n"),
            transaction: true,
            statements,
          },
          {
            ...deps,
            logger: { ...silent, success: () => {} } as never,
            options: {} as never,
          }
        );

      const before = await version();
      await failingAtTheVersion(run);
      expect(await hasRow("dynamic_collections", slug)).toBe(false);
      expect(await version()).toEqual(before);
      const ledger = new SchemaEventsRepository(adapter.getDrizzle(), dialect);
      expect(await ledger.isFileApplied(`${NEWER}.sql`)).toBe(true);

      await run();
      expect(await hasRow("dynamic_collections", slug)).toBe(true);
      expect(await ledger.isFileApplied(`${NEWER}.sql`)).toBe(false);
      expect(await version()).toEqual({
        migration: OLDER,
        seq: (before?.seq ?? 0) + 1,
      });
    });

    it("the Builder save's registry writes: a Single, a field group and a collection row's update", async () => {
      const suffix = dialect.slice(0, 2);
      const singles = new SingleRegistryService(adapter, consoleLogger);
      const fieldGroups = new FieldGroupRegistryService(adapter, consoleLogger);
      const saves: {
        table: string;
        slug: string;
        save: () => Promise<unknown>;
      }[] = [
        {
          table: "dynamic_singles",
          slug: `svw_single_${suffix}`,
          save: () =>
            writeRegistryRowsWith(adapter, () =>
              singles.registerSingle({
                slug: `svw_single_${suffix}`,
                label: "Svw single",
                tableName: `single_svw_single_${suffix}`,
                fields: [{ name: "headline", type: "text" }] as never,
                source: "ui",
                schemaHash: "svw",
              })
            ),
        },
        {
          table: await resolveRegistryTableName(adapter),
          slug: `svw_group_${suffix}`,
          save: () =>
            writeRegistryRowsWith(adapter, () =>
              fieldGroups.registerComponent({
                slug: `svw_group_${suffix}`,
                label: "Svw group",
                tableName: `comp_svw_group_${suffix}`,
                fields: [{ name: "headline", type: "text" }] as never,
                source: "ui",
                schemaHash: "svw",
              })
            ),
        },
      ];
      for (const { table, slug, save } of saves) {
        const before = await version();
        await failingAtTheVersion(save);
        expect(await hasRow(table, slug), `${table} after a failure`).toBe(
          false
        );
        expect(await version()).toEqual(before);

        await save();
        expect(await hasRow(table, slug), `${table} after a commit`).toBe(true);
        expect(await version()).toEqual({
          migration: before?.migration ?? null,
          seq: (before?.seq ?? 0) + 1,
        });
      }

      // The save's own update of a collection row, after its schema change.
      const slug = `svw_update_${suffix}`;
      await runMigrationStatements(
        adapter,
        [
          buildCollectionMetadataUpsert(
            builderCollection(slug) as never,
            dialect
          ),
        ],
        { source: "svw-fixture", transaction: true }
      );
      const update = () =>
        writeRegistryRows(adapter, tx =>
          tx.update(
            "dynamic_collections",
            { schema_version: 7, updated_at: new Date() },
            { and: [{ column: "slug", op: "=", value: slug }] }
          )
        );
      const storedVersion = async () =>
        await adapter.selectOne<{
          schemaVersion?: number;
          schema_version?: number;
        }>("dynamic_collections", {
          where: { and: [{ column: "slug", op: "=", value: slug }] },
        });
      const before = await version();
      const rowBefore = await storedVersion();
      await failingAtTheVersion(update);
      expect(await storedVersion()).toEqual(rowBefore);
      expect(await version()).toEqual(before);

      await update();
      expect(await storedVersion()).not.toEqual(rowBefore);
      expect(await version()).toEqual({
        migration: before?.migration ?? null,
        seq: (before?.seq ?? 0) + 1,
      });
    });

    it("a plugin install's lifecycle record", async () => {
      const plugin = `@test/svw-${dialect}`;
      const ledger = new SchemaEventsRepository(adapter.getDrizzle(), dialect);
      const recorded = async () =>
        (await ledger.listPluginLifecycle()).some(
          row => row.scopeSlug === plugin
        );
      const install = () =>
        writeRegistryRows(adapter, tx =>
          recordPluginLifecycle(
            new SchemaEventsRepository(tx.getDrizzle(), dialect),
            plugin,
            { state: "installed" }
          )
        );

      const before = await version();
      await failingAtTheVersion(install);
      expect(await recorded()).toBe(false);
      expect(await version()).toEqual(before);

      await install();
      expect(await recorded()).toBe(true);
      expect(await version()).toEqual({
        migration: before?.migration ?? null,
        seq: (before?.seq ?? 0) + 1,
      });
    });

    it("a run stopped after a migration's first schema statement leaves the version as it was", async () => {
      const suffix = dialect.slice(0, 2);
      const slug = `svw_stop_${suffix}`;
      const table = `dc_svw_stop_${suffix}`;
      // The file `migrate:create` writes for a new Builder collection: its
      // table, its registry row, and the version statement after the row.
      const generated = await generateMigration({
        name: "create_svw_stop",
        dialect,
        migrationsDir: dir,
        collections: [
          {
            slug,
            tableName: table,
            fields: [{ name: "headline", type: "text" }],
          },
        ],
        singles: [],
        components: [],
        nonInteractive: true,
        now: new Date("2026-03-01T00:00:00.000Z"),
        metadataUpserts: [
          {
            tableName: table,
            sql: buildCollectionMetadataUpsert(
              { ...builderCollection(slug) } as never,
              dialect
            ),
          },
        ],
      });
      // MySQL commits a schema statement whatever the file asks; on the other
      // two the file is marked to run outside a transaction, statement by
      // statement, so its schema statement commits there too.
      const transaction = dialect === "mysql";
      const { upSql } = parseSqlSections(
        await readFile(generated!.sqlPath, "utf-8")
      );
      const statements = splitSqlStatements(upSql, dialect, { transaction });
      expect(statements[0]).toMatch(/CREATE TABLE/i);
      // The version statement last, after the registry row (the splitter
      // drops its closing semicolon).
      expect(`${statements.at(-1)};`).toBe(schemaVersionStoreSql(dialect));
      expect(statements.at(-2)).toMatch(/dynamic_collections/);
      // Where the run stops: after the first schema statement, the next one
      // fails and nothing after it runs, as when the process is killed there.
      const stopped = [
        statements[0],
        "SELECT missing_column FROM nextly_meta",
        ...statements.slice(1),
      ];
      const run = (list: string[]) =>
        runMigrationStatements(adapter, list, {
          source: "20260301_000000_000_create_svw_stop.sql",
          transaction,
        });

      const before = await version();
      await expect(run(stopped)).rejects.toBeDefined();
      // The schema statement committed: the stop came after it.
      expect(await adapter.tableExists(table)).toBe(true);
      expect(await hasRow("dynamic_collections", slug)).toBe(false);
      expect(await version()).toEqual(before);

      // The control: the same file run to its end writes the row and moves
      // the version.
      await adapter.executeQuery(`DROP TABLE ${table}`);
      await run(statements);
      expect(await hasRow("dynamic_collections", slug)).toBe(true);
      expect(await version()).toEqual({
        migration: before?.migration ?? null,
        seq: (before?.seq ?? 0) + 1,
      });
    });

    // The migrations folder each case writes, removed with it.
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });
  }
);
