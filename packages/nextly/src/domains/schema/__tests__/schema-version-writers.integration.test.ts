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
 * - the Schema Builder's saves, through the handlers the admin calls (the
 *   second suite below).
 *
 * A plugin install's and uninstall's lifecycle record is covered beside the
 * rest of the install, in `plugin-lifecycle-states.integration.test.ts`.
 *
 * And a run stopped after a migration's first schema statement committed,
 * before its registry rows: on MySQL, where a schema statement commits, and
 * on PostgreSQL and SQLite with a file marked to run outside a transaction.
 * The stop is the next statement failing, which ends the run there as a
 * killed process would; the version is left as it was.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  vi,
} from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import {
  downDatabaseDeps,
  rollBackOne,
} from "../../../cli/commands/migrate-down";
import { installRegistryResolver } from "../../../cli/utils/registry-resolver";
import { createAdapter } from "../../../database/factory";
import { shutdownServices } from "../../../di/register";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { consoleLogger } from "../../../shared/types";
import { resolveRegistryTableName } from "../../field-groups/storage/resolve-storage-names";
import { getSchemaEventsDdl } from "../events/schema-events-ddl";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import { generateMigration } from "../migrate-create/generate";
import { EMPTY_SNAPSHOT, writeSnapshot } from "../migrate-create/snapshot-io";
import { runMigrationStatements } from "../migrate/migration-transaction";
import { noPendingEntities } from "../migrate/pending-entities";
import { reconcileMigrationMetadata } from "../migrate/reconcile-metadata";
import { splitSqlStatements } from "../migrate/split-sql";
import { parseSqlSections } from "../migrate/sql-sections";
import {
  readSchemaVersion,
  schemaVersionStoreSql,
  storeSchemaVersion,
  type SchemaVersion,
} from "../schema-version";
import { buildCollectionMetadataUpsert } from "../ui-schema/metadata-sql";

const SEED = "20250101_000000_000_seed";
const MIGRATED = "20260101_000000_000_migrate_svw";
const REGISTERED = "20260101_000001_000_register_svw";
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

    it("`nextly migrate`'s registration from snapshots: a row it could not write keeps the migration where it was", async () => {
      const suffix = dialect.slice(0, 2);
      const table = `dc_svw_reg_${suffix}`;
      const slugs = [`svw_reg_a_${suffix}`, `svw_reg_b_${suffix}`];
      await recordApplied(REGISTERED);
      // Two collections a snapshot records on one table: the registry holds
      // a table once, so one row is written and the other refused.
      mkdirSync(join(dir, "meta"));
      writeFileSync(
        join(dir, "meta", `${REGISTERED}.snapshot.json`),
        JSON.stringify({
          collections: slugs.map(slug => ({
            slug,
            label: slug,
            tableName: table,
            fields: [],
          })),
          singles: [],
        })
      );

      const before = await version();
      const result = await reconcileMigrationMetadata({
        adapter,
        dialect,
        migrationsDir: dir,
        logger: silent,
        registryRows: "insert-missing",
        readPendingEntitiesFn: async () => noPendingEntities(),
      });
      expect(result.rowsNotWritten).toHaveLength(1);
      const written = await Promise.all(
        slugs.map(slug => hasRow("dynamic_collections", slug))
      );
      expect(written.filter(Boolean)).toHaveLength(1);
      // A row was written, so the count moves; one was not, so the
      // migration stays where it was.
      expect(await version()).toEqual({
        migration: before?.migration ?? null,
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

/**
 * The Schema Builder's saves, driven through the handlers the admin calls:
 * creating a Single, a field group and a collection, and confirming a
 * collection's schema change. Each runs its schema statements, then writes
 * its registry row and the stored schema version in one transaction; with
 * `nextly_meta` taken away for the save, the version's write fails at the
 * end of that transaction, which the save's error, its logged warning or the
 * schema statements it left behind show it reached; the row is not written.
 * The committed save of the same kind writes both.
 * A save whose registry write did not share the version's transaction keeps
 * its row when the version cannot be written, and fails here.
 */
describe.each(getConfiguredTestDialects())(
  "a Builder save's registry row and the schema version (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    const suffix = dialect.slice(0, 2);

    async function started(): Promise<TestNextly> {
      current = await createTestNextly({ dialect });
      await storeSchemaVersion(current.adapter.getDrizzle(), dialect, {
        wrote: true,
        migration: SEED,
      });
      return current;
    }

    async function versionOf(
      t: TestNextly
    ): Promise<SchemaVersion | undefined> {
      const stored = await readSchemaVersion(t.adapter.getDrizzle(), dialect);
      return stored.present ? stored.version : undefined;
    }

    /** The registry row `table` holds for `slug`, or null. */
    function rowOf(
      t: TestNextly,
      table: string,
      slug: string
    ): Promise<Record<string, unknown> | null> {
      return t.adapter.selectOne(table, {
        where: { and: [{ column: "slug", op: "=", value: slug }] },
      });
    }

    /**
     * Runs `save` with `nextly_meta` taken away, whatever the save answers,
     * and says what it reported of the failure: the error it threw, and the
     * warnings it logged, each with the context it carried.
     */
    async function savedWithoutTheVersionTable(
      t: TestNextly,
      save: () => Promise<unknown>
    ): Promise<string> {
      const warned = vi.spyOn(consoleLogger, "warn");
      await t.adapter.executeQuery(
        "ALTER TABLE nextly_meta RENAME TO nextly_meta_away"
      );
      let reported = "";
      let logged: string[] = [];
      try {
        await save().catch((error: unknown) => {
          reported = `${String(error)} ${JSON.stringify(
            (error as { logContext?: unknown }).logContext ?? null
          )}`;
        });
      } finally {
        await t.adapter.executeQuery(
          "ALTER TABLE nextly_meta_away RENAME TO nextly_meta"
        );
        // Read before the spy is restored, which clears what it recorded.
        logged = warned.mock.calls.map(call => call.map(String).join(" "));
        warned.mockRestore();
      }
      return [reported, ...logged].join("\n");
    }

    /** The version after a committed save: the migration kept, the count moved. */
    async function expectMoved(t: TestNextly, before?: SchemaVersion) {
      const after = await versionOf(t);
      expect(after?.migration).toBe(SEED);
      expect(after?.seq ?? 0).toBeGreaterThan(before?.seq ?? 0);
    }

    const fields = [{ name: "headline", type: "text" }];

    it("creating a Single", async () => {
      const t = await started();
      const create = (slug: string) =>
        dispatchSingles("createSingle", {}, { slug, label: slug, fields });
      const failed = `svb_single_fail_${suffix}`;
      const before = await versionOf(t);
      await savedWithoutTheVersionTable(t, () => create(failed));
      expect(await t.adapter.tableExists(`single_${failed}`)).toBe(true);
      expect(await rowOf(t, "dynamic_singles", failed)).toBeNull();
      expect(await versionOf(t)).toEqual(before);

      const saved = `svb_single_${suffix}`;
      await create(saved);
      expect(await rowOf(t, "dynamic_singles", saved)).not.toBeNull();
      await expectMoved(t, before);
    });

    it("creating a field group", async () => {
      const t = await started();
      const table = await resolveRegistryTableName(t.adapter);
      const create = (slug: string) =>
        dispatchComponents(
          "createComponent",
          {},
          { slug, label: slug, fields }
        );
      const failed = `svb_group_fail_${suffix}`;
      const before = await versionOf(t);
      await savedWithoutTheVersionTable(t, () => create(failed));
      expect(await t.adapter.tableExists(`comp_${failed}`)).toBe(true);
      expect(await rowOf(t, table, failed)).toBeNull();
      expect(await versionOf(t)).toEqual(before);

      const saved = `svb_group_${suffix}`;
      await create(saved);
      expect(await rowOf(t, table, saved)).not.toBeNull();
      await expectMoved(t, before);
    });

    it("creating a collection", async () => {
      const t = await started();
      const create = (name: string) =>
        dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          {
            name,
            label: name,
            fields,
          }
        );
      const failed = `svb_coll_fail_${suffix}`;
      const before = await versionOf(t);
      // The save failed at the version's write, the last of its
      // transaction: it reached its registry write.
      expect(
        await savedWithoutTheVersionTable(t, () => create(failed))
      ).toContain("nextly_meta");
      expect(await rowOf(t, "dynamic_collections", failed)).toBeNull();
      expect(await versionOf(t)).toEqual(before);

      const saved = `svb_coll_${suffix}`;
      await create(saved);
      expect(await rowOf(t, "dynamic_collections", saved)).not.toBeNull();
      await expectMoved(t, before);
    });

    it("confirming a collection's schema change", async () => {
      const t = await started();
      const slug = `svb_apply_${suffix}`;
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        {
          name: slug,
          label: slug,
          fields,
        }
      );
      const apply = (field: string, schemaVersion: number) =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: slug },
          {
            fields: [...fields, { name: field, type: "text" }],
            confirmed: true,
            schemaVersion,
          }
        );
      const storedFields = async () =>
        JSON.stringify((await rowOf(t, "dynamic_collections", slug))?.fields);
      const fieldsBefore = await storedFields();
      const before = await versionOf(t);
      // The save reports the registry write it could not make: the version's
      // write, the last of that write's transaction, failed.
      expect(
        await savedWithoutTheVersionTable(t, () => apply("summary", 1))
      ).toContain("nextly_meta");
      expect(await storedFields()).toBe(fieldsBefore);
      expect(await versionOf(t)).toEqual(before);

      await apply("summary", 1);
      expect(await storedFields()).toContain("summary");
      await expectMoved(t, before);
    });
  }
);
