/**
 * `nextly migrate` moves an earlier release's migration records itself.
 *
 * An earlier release kept its migration records in `nextly_migrations` and
 * `nextly_migration_journal`. `nextly migrate` finds them, and once a backup
 * is confirmed (`--backup-confirmed`) moves them into `nextly_schema_events`
 * under the schema lock, drops both tables, and carries on as on any
 * database. Without the confirmation, and with nobody to ask, it changes
 * nothing and names the flag.
 *
 * Each case builds that database the way a site gets one: `migrate:create`
 * and `nextly migrate` from a configuration, then the ledger put back as the
 * earlier release left it. What would separate a correct run from a broken
 * one:
 *
 * - the records lost or misread, and the run sees its migration file as
 *   never applied and runs it again, which fails on the table it creates;
 * - a write of the move made with the lock free, or held under another
 *   command's name;
 * - a refusal that leaves something behind: the events table, the lock's own
 *   table, a row.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import {
  defineCollection,
  defineConfig,
  text,
  type CollectionConfig,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import {
  readSchemaLockState,
  type SchemaLockReading,
} from "../../../domains/schema/pipeline/schema-lock";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { NextlyError } from "../../../errors";
import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

type LoadedConfig = Parameters<typeof MergeSetupResultIntoConfig>[0];
type Row = Record<string, unknown>;

/** The config the commands load, and the project they run in, set before each run. */
const state = vi.hoisted(() => ({ config: undefined as unknown, dir: "" }));

vi.mock("../../utils/config-loader", async importOriginal => {
  const original =
    await importOriginal<typeof import("../../utils/config-loader")>();
  return {
    ...original,
    loadConfig: async () => {
      const config = state.config as LoadedConfig;
      return {
        config: original.mergeSetupResultIntoConfig(
          config,
          config,
          config.plugins ?? []
        ),
        appConfig: config,
        pluginConsent: undefined,
        projectRoot: state.dir,
        dependencies: [],
      };
    },
  };
});

/** Called before each batch of schema statements the move runs, with the statements. */
const beforeStatements = vi.hoisted(() => ({
  probe: undefined as
    | ((statements: readonly string[]) => Promise<void>)
    | undefined,
}));

// The move's schema statements (the events table's creation and each drop)
// go through this runner: the real one, with the test told first.
vi.mock(
  "../../../domains/schema/busy-table/run-on-session",
  async importOriginal => {
    const original =
      await importOriginal<
        typeof import("../../../domains/schema/busy-table/run-on-session")
      >();
    return {
      ...original,
      runStatementsInTries: async (
        ...args: Parameters<typeof original.runStatementsInTries>
      ) => {
        await beforeStatements.probe?.(args[1]);
        return original.runStatementsInTries(...args);
      },
    };
  }
);

const POSTS = "mcl-posts";
const POSTS_TABLE = "dc_mcl_posts";

const POSTS_COLLECTION: CollectionConfig = defineCollection({
  slug: POSTS,
  fields: [text({ name: "title" })],
});

const CONFIG = defineConfig({
  collections: [POSTS_COLLECTION],
  db: { migrationsDir: "./migrations" },
});

/** The file ledger, as `nextly migrate` kept it before `nextly_schema_events`. */
function fileLedgerDdl(dialect: TestDialect): string[] {
  if (dialect === "postgresql") {
    return [
      `CREATE TABLE "nextly_migrations" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "filename" TEXT NOT NULL UNIQUE, "sha256" CHAR(64) NOT NULL, "status" TEXT NOT NULL, "applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "applied_by" TEXT, "duration_ms" INTEGER, "error_json" JSONB)`,
    ];
  }
  if (dialect === "mysql") {
    return [
      "CREATE TABLE `nextly_migrations` (`id` VARCHAR(36) PRIMARY KEY, `filename` VARCHAR(255) NOT NULL UNIQUE, `sha256` CHAR(64) NOT NULL, `status` VARCHAR(20) NOT NULL, `applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `applied_by` VARCHAR(255), `duration_ms` INT, `error_json` JSON)",
    ];
  }
  return [
    `CREATE TABLE "nextly_migrations" ("id" TEXT PRIMARY KEY, "filename" TEXT NOT NULL UNIQUE, "sha256" TEXT NOT NULL, "status" TEXT NOT NULL, "applied_at" INTEGER NOT NULL, "applied_by" TEXT, "duration_ms" INTEGER, "error_json" TEXT)`,
  ];
}

/** The journal an earlier release kept beside the ledger. */
function journalDdl(dialect: TestDialect): string {
  const q = dialect === "mysql" ? "`" : '"';
  const time =
    dialect === "postgresql"
      ? "TIMESTAMPTZ"
      : dialect === "mysql"
        ? "DATETIME(3)"
        : "INTEGER";
  const columns = [
    "id VARCHAR(36) PRIMARY KEY",
    "source VARCHAR(20) NOT NULL",
    "status VARCHAR(20) NOT NULL",
    `started_at ${time}`,
    `ended_at ${time}`,
    "duration_ms INTEGER",
    "scope_kind VARCHAR(20)",
    "scope_slug VARCHAR(255)",
  ].map(column => column.replace(/^(\w+)/, `${q}$1${q}`));
  return `CREATE TABLE ${q}nextly_migration_journal${q} (${columns.join(", ")})`;
}

describe.each(getConfiguredTestDialects())(
  "nextly migrate on a database with the legacy bookkeeping tables (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;
    const q = dialect === "mysql" ? "`" : '"';
    const id = (name: string) => `${q}${name}${q}`;

    beforeEach(async () => {
      state.dir = mkdtempSync(join(tmpdir(), "nextly-migrate-legacy-"));
      mkdirSync(join(state.dir, "migrations"));
      state.config = CONFIG;
      if (dialect === "sqlite") {
        url = `file:${join(state.dir, "site.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_mcl");
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv(
        "NEXTLY_SECRET",
        process.env.NEXTLY_SECRET ??
          "test-secret-must-be-at-least-32-characters-long!!"
      );
      _resetEnvCache();
    }, 60_000);

    afterEach(async () => {
      beforeStatements.probe = undefined;
      setNonInteractive(false);
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      rmSync(state.dir, { recursive: true, force: true });
    });

    /** A command's context, with everything it says captured. */
    function command(): { context: CommandContext; said: string[] } {
      const said: string[] = [];
      const base = createLogger({ quiet: true });
      const capture = (message: string) => {
        said.push(message);
      };
      return {
        context: {
          logger: {
            ...base,
            info: capture,
            warn: capture,
            success: capture,
            error: capture,
          },
          options: {},
          cwd: state.dir,
        } as CommandContext,
        said,
      };
    }

    function messageOf(error: unknown): string {
      return NextlyError.is(error)
        ? error.publicMessage
        : String((error as Error).message);
    }

    /** With a connection of the test's own, closed after. */
    async function on<T>(fn: (adapter: DrizzleAdapter) => Promise<T>) {
      const adapter = (await createAdapter({
        type: dialect,
        url,
      } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
      try {
        return await fn(adapter);
      } finally {
        await adapter.disconnect();
      }
    }

    const sql = (statement: string) =>
      on(adapter => adapter.executeQuery<Row>(statement));

    /** `nextly migrate` with `options`; what it said, or the error it refused with. */
    async function migrate(
      options: { backupConfirmed?: boolean; dryRun?: boolean } = {}
    ): Promise<string[]> {
      const { context, said } = command();
      await runMigrate(
        { cwd: state.dir, throwOnFailure: true, ...options },
        context
      );
      return said;
    }

    /** A site on this release: its migration made and applied. */
    async function siteOnThisRelease(): Promise<void> {
      const { context, said } = command();
      setNonInteractive(true);
      try {
        await runMigrateCreate("posts", { cwd: state.dir }, context);
        await migrate();
      } catch (error) {
        throw new Error(
          `setup failed: ${messageOf(error)}\n${said.join("\n")}`
        );
      } finally {
        setNonInteractive(false);
      }
    }

    /** The applied migration files the ledger records, as `nextly migrate` wrote them. */
    async function appliedFiles(): Promise<
      { filename: string; sha256: string }[]
    > {
      const rows = await sql(
        `SELECT ${id("filename")} AS filename, ${id("sha256")} AS sha256 FROM ${id("nextly_schema_events")} WHERE ${id("event_type")} = 'file_apply' AND ${id("status")} = 'applied'`
      );
      return rows.map(row => ({
        filename: String(row.filename),
        sha256: String(row.sha256),
      }));
    }

    /**
     * The database as the earlier release left it: its applied files recorded
     * in `nextly_migrations`, one finished push in `nextly_migration_journal`,
     * and no events table. Returns the applied files' names.
     */
    async function asTheEarlierReleaseLeftIt(): Promise<string[]> {
      const files = await appliedFiles();
      expect(files.length).toBeGreaterThan(0);
      for (const statement of fileLedgerDdl(dialect)) await sql(statement);
      for (const file of files) {
        await sql(
          `INSERT INTO ${id("nextly_migrations")} (${id("id")}, ${id("filename")}, ${id("sha256")}, ${id("status")}${dialect === "sqlite" ? `, ${id("applied_at")}` : ""}) VALUES ('${randomUUID()}', '${file.filename}', '${file.sha256}', 'applied'${dialect === "sqlite" ? `, ${Date.now()}` : ""})`
        );
      }
      await sql(journalDdl(dialect));
      await sql(
        `INSERT INTO ${id("nextly_migration_journal")} (${id("id")}, ${id("source")}, ${id("status")}, ${id("duration_ms")}) VALUES ('${randomUUID()}', 'ui', 'success', 12)`
      );
      await sql(`DROP TABLE ${id("nextly_schema_events")}`);
      return files.map(file => file.filename);
    }

    /** The name of every table in the database, sorted. */
    async function tableNames(): Promise<string[]> {
      const rows = await sql(
        dialect === "sqlite"
          ? `SELECT name AS table_name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
          : dialect === "postgresql"
            ? `SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`
            : `SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`
      );
      return rows.map(row => String(row.table_name)).sort();
    }

    /** Every table with every row it holds, as text: equal only when nothing changed. */
    async function everyTable(): Promise<Record<string, string[]>> {
      const tables: Record<string, string[]> = {};
      for (const table of await tableNames()) {
        const rows = await sql(`SELECT * FROM ${id(table)}`);
        tables[table] = rows
          .map(row =>
            JSON.stringify(row, (_key, value: unknown) =>
              value instanceof Uint8Array
                ? Buffer.from(value).toString("hex")
                : typeof value === "bigint"
                  ? value.toString()
                  : value
            )
          )
          .sort();
      }
      return tables;
    }

    /** Each file's `file_apply` events, by file. */
    async function fileApplies(): Promise<Map<string, Row[]>> {
      const rows = await sql(
        `SELECT ${id("filename")} AS filename FROM ${id("nextly_schema_events")} WHERE ${id("event_type")} = 'file_apply'`
      );
      const byFile = new Map<string, Row[]>();
      for (const row of rows) {
        const key = String(row.filename);
        byFile.set(key, [...(byFile.get(key) ?? []), row]);
      }
      return byFile;
    }

    const legacyTables = () =>
      on(async adapter => ({
        migrations: await adapter.tableExists("nextly_migrations"),
        journal: await adapter.tableExists("nextly_migration_journal"),
      }));

    it("a database with the legacy tables and --backup-confirmed: consolidated, the lock held throughout", async () => {
      await siteOnThisRelease();
      const files = await asTheEarlierReleaseLeftIt();
      const posts = await everyTable().then(tables => tables[POSTS_TABLE]);

      // The lock as another connection reads it, at each write of the move:
      // before each batch of its schema statements, and before each record
      // it writes into the events table.
      const readings: { at: string; lock: SchemaLockReading }[] = [];
      const read = async (at: string) => {
        readings.push({ at, lock: await on(readSchemaLockState) });
      };
      beforeStatements.probe = statements =>
        read(statements.map(statement => statement.slice(0, 60)).join(" | "));
      const insert = SchemaEventsRepository.prototype.insertEvent;
      let moving = true;
      vi.spyOn(
        SchemaEventsRepository.prototype,
        "insertEvent"
      ).mockImplementation(async function (
        this: SchemaEventsRepository,
        values
      ) {
        if (moving) await read(`record ${String(values.source)}`);
        return insert.call(this, values);
      });
      // The move is over once both tables are gone: later writes are the
      // ordinary run's, under its own hold of the lock.
      const probe = beforeStatements.probe;
      beforeStatements.probe = async statements => {
        await probe(statements);
        if (statements.some(s => s.includes("nextly_migration_journal"))) {
          moving = false;
          beforeStatements.probe = undefined;
        }
      };

      setNonInteractive(true);
      const said = await migrate({ backupConfirmed: true });

      // Both legacy tables are gone, and the run went on to finish.
      expect(await legacyTables()).toEqual({
        migrations: false,
        journal: false,
      });
      // Every applied file recorded once: none read as never applied and run
      // again, which would have failed on the table it creates.
      const applies = await fileApplies();
      for (const file of files) expect(applies.get(file), file).toHaveLength(1);
      const [journaled] = await sql(
        `SELECT COUNT(*) AS n FROM ${id("nextly_schema_events")} WHERE ${id("event_type")} <> 'file_apply' AND ${id("source")} <> 'legacy-prebackfill' AND ${id("duration_ms")} = 12`
      );
      expect(Number(journaled?.n)).toBe(1);
      expect((await everyTable())[POSTS_TABLE]).toEqual(posts);
      expect(said.join("\n")).toContain("Dropped nextly_migrations");
      expect(said.join("\n")).toContain("Dropped nextly_migration_journal");

      // The events table's creation, each record and each drop were reached,
      // and at every one of them the lock was held by `nextly migrate`.
      const reached = readings.map(reading => reading.at).join("\n");
      expect(reached).toMatch(/CREATE TABLE/);
      expect(reached).toMatch(/record /);
      expect(reached).toMatch(/DROP TABLE IF EXISTS .nextly_migrations/);
      expect(reached).toMatch(/DROP TABLE IF EXISTS .nextly_migration_journal/);
      expect(
        readings.filter(
          ({ lock }) =>
            !(
              lock.state === "held" &&
              lock.holder.kind === "schema" &&
              lock.holder.command === "nextly migrate"
            )
        )
      ).toEqual([]);
      // And released once the run ended.
      expect(await on(readSchemaLockState)).toEqual({ state: "free" });

      // A second run finds nothing to move and nothing to apply.
      await migrate();
      expect((await fileApplies()).get(files[0] ?? "")).toHaveLength(1);
    }, 240_000);

    it("without the confirmation: every table byte for byte, the flag named", async () => {
      await siteOnThisRelease();
      await asTheEarlierReleaseLeftIt();
      const before = await everyTable();
      expect(Object.keys(before)).toContain("nextly_migrations");

      // Standard input closed: nobody can be asked.
      setNonInteractive(true);
      const refusal = await migrate().then(
        () => undefined,
        (error: unknown) => error
      );

      expect(NextlyError.is(refusal) ? refusal.publicMessage : refusal).toMatch(
        /--backup-confirmed/
      );
      // No table gained, lost or changed: not the events table, not the
      // lock's own, not a row of either legacy table.
      expect(await everyTable()).toEqual(before);
    }, 240_000);

    it("--dry-run lists the move and changes nothing", async () => {
      await siteOnThisRelease();
      const files = await asTheEarlierReleaseLeftIt();
      const before = await everyTable();

      setNonInteractive(true);
      const said = (await migrate({ dryRun: true })).join("\n");

      expect(said).toContain(
        `Would move ${String(files.length)} ${files.length === 1 ? "record" : "records"} from nextly_migrations into nextly_schema_events`
      );
      expect(said).toContain("Would remove table nextly_migrations");
      expect(said).toContain("Would remove table nextly_migration_journal");
      expect(said).toMatch(/A real run would refuse: .*--backup-confirmed/);
      expect(said).toContain("Dry run: nothing was changed.");
      expect(await everyTable()).toEqual(before);
    }, 240_000);
  }
);
