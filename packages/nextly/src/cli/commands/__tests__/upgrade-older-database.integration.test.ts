/**
 * An older database upgrades to this release and starts.
 *
 * An earlier release kept its migration records in `nextly_migrations`, in
 * one of two shapes: the file ledger `nextly migrate` wrote, and the shape
 * before it, which `nextly db:sync` went on creating, empty, on every SQLite
 * database it reconciled. Either way `nextly migrate` refuses the database
 * until `nextly upgrade` has moved the records into `nextly_schema_events`.
 * The version columns this release added (`changed_locales`,
 * `shared_changed`) are missing too, as on any database an earlier release
 * made.
 *
 * Each case builds that database the way a site gets one: `migrate:create`
 * and `nextly migrate` from a configuration, a start that writes a document
 * and its versions, then the ledger and the columns put back as the earlier
 * release left them. Then, as the upgrade guide says: `nextly upgrade`,
 * `nextly migrate`, and a start, which reads the document's versions and
 * writes one more. What would separate a correct move from a broken one:
 *
 * - the records lost or misread, and `nextly migrate` sees its migration
 *   file as never applied and runs it again, which fails on the tables it
 *   creates;
 * - a time misread by its unit lands in 1970 rather than today;
 * - the columns not added, and the start's version read and write fail.
 *
 * And a run stopped part-way, run again, finishes the move with every record
 * written once.
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
import type { VersionsNamespace } from "../../../direct-api/namespaces/versions";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { NextlyError } from "../../../errors";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { mergeSetupResultIntoConfig as MergeSetupResultIntoConfig } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";
import { runUpgrade, type UpgradeAdapter } from "../upgrade";

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

const POSTS = "uod-posts";
const POSTS_TABLE = "dc_uod_posts";

const POSTS_COLLECTION: CollectionConfig = defineCollection({
  slug: POSTS,
  versions: true,
  fields: [text({ name: "title" })],
});

const CONFIG = defineConfig({
  collections: [POSTS_COLLECTION],
  db: { migrationsDir: "./migrations" },
});

/** A record of a run that never finished, which the move skips. */
const NEVER_FINISHED = "20200101_000000_000_never_finished.sql";

/**
 * How the earlier release kept the ledger.
 *
 * - `earlier-empty`: the shape before the file ledger, created empty by a
 *   `nextly db:sync`, beside a `nextly_schema_events` that holds the history;
 * - `earlier`: that shape holding the history, with no events table yet;
 * - `file-ledger`: the file ledger holding the history, with no events table.
 */
type Ledger = "earlier-empty" | "earlier" | "file-ledger";

/** The shape before the file ledger, as the sync's system-table step created it. */
function earlierLedgerDdl(dialect: TestDialect): string[] {
  if (dialect === "postgresql") {
    return [
      `CREATE TABLE "nextly_migrations" ("id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "name" VARCHAR(255) NOT NULL UNIQUE, "batch" INTEGER NOT NULL, "checksum" VARCHAR(64) NOT NULL, "status" VARCHAR(20) NOT NULL DEFAULT 'pending', "error_message" TEXT, "executed_at" TIMESTAMP NOT NULL DEFAULT NOW())`,
    ];
  }
  if (dialect === "mysql") {
    return [
      "CREATE TABLE `nextly_migrations` (`id` VARCHAR(36) PRIMARY KEY, `name` VARCHAR(255) NOT NULL UNIQUE, `batch` INTEGER NOT NULL, `checksum` VARCHAR(64) NOT NULL, `status` VARCHAR(20) NOT NULL DEFAULT 'pending', `error_message` TEXT, `executed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ];
  }
  return [
    `CREATE TABLE "nextly_migrations" ("id" TEXT PRIMARY KEY, "name" TEXT NOT NULL UNIQUE, "batch" INTEGER NOT NULL, "checksum" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending', "error_message" TEXT, "executed_at" INTEGER NOT NULL DEFAULT (strftime('%s', 'now')))`,
  ];
}

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

describe.each(getConfiguredTestDialects())(
  "an older database upgrades to this release and starts (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;
    const q = dialect === "mysql" ? "`" : '"';
    const id = (name: string) => `${q}${name}${q}`;

    beforeEach(async () => {
      state.dir = mkdtempSync(join(tmpdir(), "nextly-upgrade-older-"));
      mkdirSync(join(state.dir, "migrations"));
      state.config = CONFIG;
      if (dialect === "sqlite") {
        url = `file:${join(state.dir, "site.db")}`;
        drop = async () => {};
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_uod");
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
      const adapter = (await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0])) as unknown as DrizzleAdapter;
      try {
        return await fn(adapter);
      } finally {
        await adapter.disconnect();
      }
    }

    const sql = (statement: string) =>
      on(adapter => adapter.executeQuery<Row>(statement));

    /** `nextly migrate`; throws what it refused with, and what it said. */
    async function migrate(): Promise<string[]> {
      const { context, said } = command();
      try {
        await runMigrate({ cwd: state.dir, throwOnFailure: true }, context);
      } catch (error) {
        throw new Error(
          `migrate failed: ${messageOf(error)}\n${said.join("\n")}`
        );
      }
      return said;
    }

    /** `nextly upgrade --confirm-backed-up`; what it said. */
    async function upgrade(): Promise<string[]> {
      const said: string[] = [];
      await on(adapter =>
        runUpgrade(
          { confirmBackedUp: true },
          {
            adapter: adapter as unknown as UpgradeAdapter,
            logger: {
              info: line => said.push(line),
              warn: line => said.push(line),
            },
          }
        )
      );
      return said;
    }

    /** A start on this database, as the site's own; destroyed after. */
    async function start<T>(fn: (t: TestNextly) => Promise<T>): Promise<T> {
      const t = await createTestNextly({
        adapter: (await createAdapter({ type: dialect, url } as Parameters<
          typeof createAdapter
        >[0])) as never,
        collections: [POSTS_COLLECTION],
      });
      try {
        return await fn(t);
      } finally {
        await t.destroy();
      }
    }

    const versionsOf = (t: TestNextly) =>
      (t.nextly as unknown as { versions: VersionsNamespace }).versions;

    /**
     * A site on this release: its migration made and applied, and a post
     * saved three times, so it has versions. Returns the post's id.
     */
    async function siteOnThisRelease(): Promise<string> {
      const { context, said } = command();
      setNonInteractive(true);
      try {
        await runMigrateCreate("posts", { cwd: state.dir }, context);
      } catch (error) {
        throw new Error(
          `migrate:create failed: ${messageOf(error)}\n${said.join("\n")}`
        );
      } finally {
        setNonInteractive(false);
      }
      await migrate();
      return start(async t => {
        const made = await t.nextly.create({
          collection: POSTS,
          data: { title: "First" },
        });
        const created = {
          id: String((made.item as { id: string | number }).id),
        };
        await t.nextly.update({
          collection: POSTS,
          id: created.id,
          data: { title: "Second", _overwrite: true },
        });
        await t.nextly.update({
          collection: POSTS,
          id: created.id,
          data: { title: "Third", _overwrite: true },
        });
        return created.id;
      });
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
     * The database as the earlier release left it: without the version
     * columns this release added, and with its ledger kept in `ledger`'s way.
     */
    async function asTheEarlierReleaseLeftIt(
      ledger: Ledger
    ): Promise<string[]> {
      for (const column of ["changed_locales", "shared_changed"]) {
        await sql(
          `ALTER TABLE ${id("nextly_versions")} DROP COLUMN ${id(column)}`
        );
      }
      const files = await appliedFiles();
      expect(files.length).toBeGreaterThan(0);
      if (ledger === "earlier-empty") {
        for (const statement of earlierLedgerDdl(dialect)) await sql(statement);
        return files.map(file => file.filename);
      }
      const ddl =
        ledger === "earlier"
          ? earlierLedgerDdl(dialect)
          : fileLedgerDdl(dialect);
      for (const statement of ddl) await sql(statement);
      for (const file of files) {
        // Times left to the column's default where it has one: `executed_at`
        // counts seconds on SQLite, which a misread would put in 1970.
        await sql(
          ledger === "earlier"
            ? `INSERT INTO ${id("nextly_migrations")} (${id("id")}, ${id("name")}, ${id("batch")}, ${id("checksum")}, ${id("status")}) VALUES ('${randomUUID()}', '${file.filename}', 1, '${file.sha256}', 'applied')`
            : `INSERT INTO ${id("nextly_migrations")} (${id("id")}, ${id("filename")}, ${id("sha256")}, ${id("status")}${dialect === "sqlite" ? `, ${id("applied_at")}` : ""}) VALUES ('${randomUUID()}', '${file.filename}', '${file.sha256}', 'applied'${dialect === "sqlite" ? `, ${Date.now()}` : ""})`
        );
      }
      if (ledger === "earlier") {
        await sql(
          `INSERT INTO ${id("nextly_migrations")} (${id("id")}, ${id("name")}, ${id("batch")}, ${id("checksum")}) VALUES ('${randomUUID()}', '${NEVER_FINISHED}', 2, '${"0".repeat(64)}')`
        );
      }
      // That release kept no events table: the upgrade makes it.
      await sql(`DROP TABLE ${id("nextly_schema_events")}`);
      return files.map(file => file.filename);
    }

    async function count(table: string): Promise<number> {
      const [row] = await sql(`SELECT COUNT(*) AS n FROM ${id(table)}`);
      return Number(row?.n ?? 0);
    }

    /** Each file's applied `file_apply` events, by file. */
    async function fileApplies(): Promise<Map<string, Row[]>> {
      const rows = await sql(
        `SELECT ${id("filename")} AS filename, ${id("started_at")} AS started_at FROM ${id("nextly_schema_events")} WHERE ${id("event_type")} = 'file_apply'`
      );
      const byFile = new Map<string, Row[]>();
      for (const row of rows) {
        const key = String(row.filename);
        byFile.set(key, [...(byFile.get(key) ?? []), row]);
      }
      return byFile;
    }

    const startedAt = (value: unknown): Date =>
      value instanceof Date ? value : new Date(Number(value));

    it.each<Ledger>(["earlier-empty", "earlier", "file-ledger"])(
      "the ledger kept as %s: upgrade, then migrate, then a start that reads and writes versions",
      async ledger => {
        const post = await siteOnThisRelease();
        const files = await asTheEarlierReleaseLeftIt(ledger);
        const before = {
          posts: await count(POSTS_TABLE),
          versions: await count("nextly_versions"),
        };
        expect(before.versions).toBeGreaterThanOrEqual(3);

        // The premise: this release refuses the database until it is upgraded.
        await expect(migrate()).rejects.toThrow(/nextly_migrations/);

        const said = await upgrade();
        expect(said.join("\n")).toContain("Dropped nextly_migrations");
        expect(
          await on(adapter => adapter.tableExists("nextly_migrations"))
        ).toBe(false);

        // Every applied file recorded once, at the time it was recorded.
        const applies = await fileApplies();
        for (const file of files) {
          const events = applies.get(file) ?? [];
          expect(events, file).toHaveLength(1);
          const at = startedAt(events[0]?.started_at).getTime();
          expect(Math.abs(Date.now() - at)).toBeLessThan(24 * 3600 * 1000);
        }
        if (ledger === "earlier") {
          expect(applies.has(NEVER_FINISHED)).toBe(false);
          expect(said.join("\n")).toContain(NEVER_FINISHED);
        }

        // `nextly migrate` now runs: no file applied again, the columns added.
        await migrate();
        expect((await fileApplies()).get(files[0] ?? "")).toHaveLength(1);
        const columns = (
          await on(adapter =>
            adapter.executeQuery<Row>(
              dialect === "sqlite"
                ? `SELECT name AS column_name FROM pragma_table_info('nextly_versions')`
                : dialect === "postgresql"
                  ? `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'nextly_versions'`
                  : `SELECT COLUMN_NAME AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'nextly_versions'`
            )
          )
        ).map(row => String(row.column_name).toLowerCase());
        expect(columns).toEqual(
          expect.arrayContaining(["changed_locales", "shared_changed"])
        );

        // A start reads the post's versions, and saving it writes one more.
        await start(async t => {
          const listed = await versionsOf(t).list({
            collection: POSTS,
            id: post,
          });
          expect(listed.items.length).toBeGreaterThan(0);
          await t.nextly.update({
            collection: POSTS,
            id: post,
            data: { title: "After the upgrade", _overwrite: true },
          });
          const after = await versionsOf(t).list({
            collection: POSTS,
            id: post,
          });
          expect(after.items.length).toBe(listed.items.length + 1);
        });

        expect(await count(POSTS_TABLE)).toBe(before.posts);
        expect(await count("nextly_versions")).toBe(before.versions + 1);

        // And a second upgrade has nothing to do.
        expect((await upgrade()).join("\n")).toContain("Nothing to do");
      },
      240_000
    );

    it("finishes a stopped upgrade, writing each record once", async () => {
      await siteOnThisRelease();
      const files = await asTheEarlierReleaseLeftIt("earlier");

      // The run stops on its second write: the first record is moved, the
      // core schema's audit row is not, and nothing is dropped.
      const insert = SchemaEventsRepository.prototype.insertEvent;
      let writes = 0;
      const spy = vi
        .spyOn(SchemaEventsRepository.prototype, "insertEvent")
        .mockImplementation(function (this: SchemaEventsRepository, values) {
          writes += 1;
          if (writes === 2) {
            return Promise.reject(new Error("stopped part-way"));
          }
          return insert.call(this, values);
        });
      await expect(upgrade()).rejects.toThrow("stopped part-way");
      spy.mockRestore();
      expect(
        await on(adapter => adapter.tableExists("nextly_migrations"))
      ).toBe(true);

      await upgrade();
      expect(
        await on(adapter => adapter.tableExists("nextly_migrations"))
      ).toBe(false);
      const applies = await fileApplies();
      for (const file of files) expect(applies.get(file), file).toHaveLength(1);
      const [core] = await sql(
        `SELECT COUNT(*) AS n FROM ${id("nextly_schema_events")} WHERE ${id("source")} = 'legacy-prebackfill'`
      );
      expect(Number(core?.n)).toBe(1);
      await migrate();
    }, 240_000);
  }
);
