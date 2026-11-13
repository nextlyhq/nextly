/**
 * `next build` writes nothing to the database but a plugin's secret seals, on
 * every dialect.
 *
 * Next.js boots the app while it builds, to prerender the pages that read
 * content, with `NODE_ENV` set to production and `NEXT_PHASE` to the build
 * phase. That build may point at a database other deployments share, from a
 * configuration older or newer than theirs, so it writes nothing there: no
 * bookkeeping, no table, no ledger row, no default row, no setup token, no
 * SQLite journal mode and none of the work after a start completes. The one
 * exception is sealing a plugin setting its manifest now marks secret, which
 * must happen before that plugin starts.
 *
 * Two instruments, because each misses what the other sees:
 * - every statement the driver is handed during the start, the work it leaves
 *   running after it resolves included (`record-statements`, `startSettled`),
 *   none of which may write;
 * - the database's structure (tables, columns, indexes, schemas, and on
 *   SQLite the journal mode and whether the file exists), read before the
 *   start and after it, which must be the same.
 *
 * The databases: one that has never been migrated, one migrated for an older
 * configuration (a collection missing, a field missing, and a translated
 * collection whose translation table is missing), and one migrated for a newer
 * configuration (a collection this build does not declare), each with
 * migrations at start off and on. A
 * build against the empty one refuses, naming `nextly migrate`. The secret
 * case is also the instrument's control: on every dialect the recorder sees
 * the seal, so an empty list of writes elsewhere is not the recorder missing
 * them.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import {
  recordStatements,
  type RecordedStatement,
} from "../../__tests__/helpers/record-statements";
import { defineCollection, defineConfig, text } from "../../config";
import { createAdapter } from "../../database/factory";
import { shutdownServices } from "../../di/register";
import { createPluginSettingsStore } from "../../domains/plugins/settings-store";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { recordPluginLifecycle } from "../../domains/schema/ownership/plugin-lifecycle-state";
import { getNextly, startSettled } from "../../init";
import {
  definePlugin,
  type PluginDefinition,
} from "../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { resetDispatcherForTests } from "../../route-handler/auth-handler";
import { createDynamicHandlers } from "../../routeHandler";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";

const PLUGIN = definePlugin({
  name: "@test/nbw",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init() {},
});

/** A collection; `withSubtitle` is the field an older configuration lacks. */
function collection(slug: string, withSubtitle = false) {
  return defineCollection({
    slug,
    fields: [
      text({ name: "title" }),
      ...(withSubtitle ? [text({ name: "subtitle" })] : []),
    ],
  });
}
/** Translated, so a build behind it would make its translation table. */
const TRANSLATED = defineCollection({
  slug: "nbwloc",
  localized: true,
  fields: [text({ name: "title" })],
});
const LOCALIZATION = { locales: ["en", "fr"], defaultLocale: "en" };

/** What the build declares. */
const BUILD_COLLECTIONS = [
  collection("nbwa"),
  collection("nbwb", true),
  collection("nbwc"),
  TRANSLATED,
];
/**
 * What an older configuration migrated: a field and a collection short. Its
 * translated collection loses its translation table once migrated
 * (`dropTranslationTable`), so the build meets a registered translated entity
 * whose translation table is missing, which a start creates.
 */
const OLDER_COLLECTIONS = [collection("nbwa"), collection("nbwb"), TRANSLATED];
/** What a newer configuration migrated: one collection more. */
const NEWER_COLLECTIONS = [...BUILD_COLLECTIONS, collection("nbwx")];

type DatabaseState = "empty" | "behind" | "ahead";
const MIGRATED_FOR: Record<DatabaseState, typeof BUILD_COLLECTIONS | null> = {
  empty: null,
  behind: OLDER_COLLECTIONS,
  ahead: NEWER_COLLECTIONS,
};

/**
 * A statement that changes the database: rows, structure, or a persistent
 * setting. `PRAGMA x = y` covers SQLite's journal mode, which the file keeps;
 * a transaction's own `BEGIN`/`COMMIT`, a lock read and the connection-scoped
 * settings change nothing that outlives the connection.
 */
const WRITE =
  /^\s*(with\b[\s\S]*?\b(insert|update|delete)\b|insert|update|delete|replace|merge|upsert|create|alter|drop|truncate|rename|vacuum|reindex|analyze)\b|^\s*pragma\s+(main\.)?journal_mode\s*=/i;

/** The writes among `calls`, shortened so a failure reads as a list. */
function writesIn(calls: readonly RecordedStatement[]): string[] {
  return calls
    .filter(call => WRITE.test(call.text))
    .map(call => call.text.replace(/\s+/g, " ").slice(0, 120));
}

describe.each(getConfiguredTestDialects())(
  "next build (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let sqliteFile: string | undefined;
    let drop: () => Promise<void>;
    let migrationsDir: string;

    const adapterFor = (): Promise<DrizzleAdapter> =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;

    /**
     * The database's structure, read on a connection of its own: the tables
     * with their columns and indexes, and the schemas; on SQLite the journal
     * mode too, and null while the file does not exist.
     */
    async function structure(): Promise<unknown> {
      if (dialect === "sqlite") {
        if (!sqliteFile || !existsSync(sqliteFile)) return null;
        const { default: Database } = await import("better-sqlite3");
        const db = new Database(sqliteFile, {
          readonly: true,
          fileMustExist: true,
        });
        try {
          return {
            objects: db
              .prepare(
                "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name"
              )
              .all(),
            journal: db.pragma("journal_mode", { simple: true }),
          };
        } finally {
          db.close();
        }
      }
      if (dialect === "postgresql") {
        const { Pool } = await import("pg");
        const pool = new Pool({ connectionString: url });
        try {
          const columns = await pool.query(
            `SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
               FROM information_schema.columns
              WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
              ORDER BY table_schema, table_name, ordinal_position`
          );
          const indexes = await pool.query(
            `SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes
              WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
              ORDER BY schemaname, tablename, indexname`
          );
          const schemas = await pool.query(
            "SELECT nspname FROM pg_namespace ORDER BY nspname"
          );
          return {
            columns: columns.rows,
            indexes: indexes.rows,
            schemas: schemas.rows,
          };
        } finally {
          await pool.end();
        }
      }
      const { createPool } = await import("mysql2");
      const pool = createPool({ uri: url });
      try {
        const db = pool.promise();
        const [columns] = await db.query(
          `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY TABLE_NAME, ORDINAL_POSITION`
        );
        const [indexes] = await db.query(
          `SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, NON_UNIQUE
             FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`
        );
        return { columns, indexes };
      } finally {
        await new Promise<void>(resolve => pool.end(() => resolve()));
      }
    }

    beforeEach(async () => {
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-build-migrations-"));
      if (dialect === "sqlite") {
        const dir = mkdtempSync(join(tmpdir(), "nextly-build-"));
        sqliteFile = join(dir, "build.db");
        url = `file:${sqliteFile}`;
        drop = async () => rmSync(dir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_build");
        url = scratch.url;
        drop = scratch.drop;
      }
      // The request path opens the database the environment names.
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
    });

    afterEach(async () => {
      await shutdownServices();
      resetDispatcherForTests();
      vi.unstubAllEnvs();
      _resetEnvCache();
      rmSync(migrationsDir, { recursive: true, force: true });
      await drop();
    });

    /**
     * Migrate the database for `collections` with `plugins` installed, as a
     * deployment of that configuration that ran `nextly migrate` and
     * `nextly plugins install` would leave it.
     */
    async function migrateFor(
      collections: typeof BUILD_COLLECTIONS,
      plugins: PluginDefinition[]
    ): Promise<void> {
      const setup = await adapterFor();
      await createTestNextly({
        adapter: setup as never,
        collections,
        plugins,
        localization: LOCALIZATION,
      });
      for (const plugin of plugins) {
        await recordPluginLifecycle(
          new SchemaEventsRepository(setup.getDrizzle(), dialect),
          plugin.name,
          { state: "installed" }
        );
      }
      await shutdownServices();
    }

    /** Drop the translated collection's translation table, as if never made. */
    async function dropTranslationTable(): Promise<void> {
      const adapter = await adapterFor();
      try {
        await adapter.executeQuery("DROP TABLE dc_nbwloc_locales");
      } finally {
        await adapter.disconnect();
      }
    }

    /** Enter the build phase, as `next build` sets it for the app it boots. */
    function enterBuildPhase(): void {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXT_PHASE", "phase-production-build");
      // A production start requires it; the build has it as the app does.
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://build.example.test");
      _resetEnvCache();
    }

    function buildConfig(
      plugins: PluginDefinition[],
      runMigrationsOnBoot: boolean
    ) {
      return sanitizeConfig(
        defineConfig({
          collections: BUILD_COLLECTIONS,
          plugins,
          localization: LOCALIZATION,
          // A user field no migrated database records: a start records its
          // definition and adds its column.
          users: { fields: [text({ name: "nickname" })] },
          db: { runMigrationsOnBoot, migrationsDir },
        })
      ) as never;
    }

    /**
     * One build-phase start by the Direct API, recorded, and a read through it
     * of a collection every database state has. Resolves to what the driver
     * was handed, or the error the start refused with.
     */
    /**
     * Install the recorder. It patches the driver's prototypes, which every
     * connection shares, so it needs a connection of its own to find them: on
     * SQLite an in-memory one, since opening the test's file would create it.
     */
    async function startRecording() {
      const host = (await createAdapter({
        type: dialect,
        url: dialect === "sqlite" ? "file::memory:" : url,
      } as Parameters<typeof createAdapter>[0])) as DrizzleAdapter;
      const recorder = await recordStatements(host, dialect);
      return {
        recorder,
        stop: async () => {
          recorder.uninstall();
          await host.disconnect();
        },
      };
    }

    /**
     * One build-phase start by the Direct API, recorded, and a read through it
     * of a collection every migrated state has. Resolves to what the driver
     * was handed, and the error the start refused with, if it did.
     */
    async function buildStart(
      plugins: PluginDefinition[],
      runMigrationsOnBoot: boolean
    ): Promise<{ calls: RecordedStatement[]; refusal?: unknown }> {
      enterBuildPhase();
      const { recorder, stop } = await startRecording();
      let adapter: DrizzleAdapter | undefined;
      try {
        // Opened inside the recording, as the build's own process opens it.
        adapter = await adapterFor();
        const nextly = await getNextly({
          config: buildConfig(plugins, runMigrationsOnBoot),
          adapter,
        });
        await startSettled();
        await nextly.find({ collection: "nbwa" });
        await startSettled();
        await nextly.shutdown();
        return { calls: [...recorder.calls] };
      } catch (refusal) {
        await adapter?.disconnect().catch(() => {});
        return { calls: [...recorder.calls], refusal };
      } finally {
        await stop();
      }
    }

    /** Everything a refusal says: its message and its public message. */
    function said(refusal: unknown): string {
      if (!(refusal instanceof Error)) return String(refusal);
      const { publicMessage } = refusal as { publicMessage?: unknown };
      return `${refusal.message} ${typeof publicMessage === "string" ? publicMessage : ""}`;
    }

    it.each([
      ["behind", false],
      ["behind", true],
      ["ahead of", false],
      ["ahead of", true],
    ] as const)(
      "against a database %s the configuration, with migrations at start %s, writes nothing and changes no structure",
      async (state, runMigrationsOnBoot) => {
        await migrateFor(
          MIGRATED_FOR[state === "ahead of" ? "ahead" : state]!,
          [PLUGIN]
        );
        if (state === "behind") await dropTranslationTable();
        const before = await structure();

        const { calls, refusal } = await buildStart(
          [PLUGIN],
          runMigrationsOnBoot
        );

        expect(refusal).toBeUndefined();
        expect(writesIn(calls)).toEqual([]);
        expect(await structure()).toEqual(before);
      },
      240_000
    );

    it.each([false, true])(
      "against an empty database, with migrations at start %s, refuses naming `nextly migrate` and writes nothing",
      async runMigrationsOnBoot => {
        // A server database exists, with nothing in it; a SQLite file does
        // not exist at all until something creates it.
        const before = await structure();

        const { calls, refusal } = await buildStart(
          [PLUGIN],
          runMigrationsOnBoot
        );

        expect(said(refusal)).toMatch(
          /Run `nextly migrate` before `next build`/
        );
        expect(writesIn(calls)).toEqual([]);
        expect(await structure()).toEqual(before);
      },
      240_000
    );

    it("begun by a request, against a database behind the configuration, writes nothing and changes no structure", async () => {
      await migrateFor(OLDER_COLLECTIONS, [PLUGIN]);
      await dropTranslationTable();
      const before = await structure();
      enterBuildPhase();
      const { recorder, stop } = await startRecording();
      try {
        // The start opens its own adapter from the environment, inside the
        // recording, so what it sends as it connects is recorded too.
        const handlers = createDynamicHandlers({
          config: buildConfig([PLUGIN], false),
        });
        const path = ["collections", "nbwa", "entries"];
        await handlers.GET(
          new Request(`http://localhost/api/${path.join("/")}`),
          { params: Promise.resolve({ params: path }) }
        );
        await startSettled();
      } finally {
        await stop();
      }
      await shutdownServices();

      expect(writesIn(recorder.calls)).toEqual([]);
      expect(await structure()).toEqual(before);
    }, 240_000);

    it("with a plugin setting newly marked secret, writes that seal and nothing else", async () => {
      const name = "@test/nbw-secrets";
      const plainValue = "plain-value-5e2b8c41d7";
      const secretPlugin = (secrets: string[]) =>
        definePlugin({
          name,
          version: "1.0.0",
          nextly: ">=0.0.0",
          capabilities: { secrets },
          contributes: { settings: z.object({ apiKey: z.string() }) },
          init() {},
        });
      // The release before marks nothing secret, and stores the value plain.
      let stored = false;
      const older = definePlugin({
        ...secretPlugin([]),
        async init(ctx) {
          await (
            ctx.settings as { set(v: { apiKey: string }): Promise<void> }
          ).set({ apiKey: plainValue });
          stored = true;
        },
      });
      await migrateFor(BUILD_COLLECTIONS, [older]);
      expect(stored).toBe(true);
      const settingsText = async (): Promise<string> => {
        const adapter = await adapterFor();
        try {
          const rows = await createPluginSettingsStore(
            adapter.getDrizzle(),
            adapter.dialect
          ).read(name);
          return rows.map(row => row.value).join("\n");
        } finally {
          await adapter.disconnect();
        }
      };
      // The premise: stored as plain text.
      expect(await settingsText()).toContain(plainValue);
      const before = await structure();

      const { calls, refusal } = await buildStart(
        [secretPlugin(["apiKey"])],
        false
      );

      expect(refusal).toBeUndefined();
      const writes = writesIn(calls);
      // The seal, and nothing else.
      expect(writes.length).toBeGreaterThan(0);
      expect(
        writes.filter(write => !/\bnextly_plugin_settings\b/.test(write))
      ).toEqual([]);
      expect(await settingsText()).not.toContain(plainValue);
      expect(await structure()).toEqual(before);
    }, 240_000);

    it("with the secret rotated, seals the plugin's settings again and nothing else", async () => {
      const name = "@test/nbw-rotated";
      const storedValue = "stored-value-71c0d3e9a4";
      // Sealed under the secret before the rotation, with a digest key the
      // plugin made beside it: the key, like the deleted-people key and held
      // messages, is sealed again by the first start after the build, never
      // by the build, which no plugin needs it for.
      let digested = false;
      const plugin = (
        atInit?: (ctx: {
          settings: unknown;
          security: {
            digests: { digest(kind: string, value: string): Promise<string> };
          };
        }) => Promise<void>
      ) =>
        definePlugin({
          name,
          version: "1.0.0",
          nextly: ">=0.0.0",
          capabilities: { secrets: ["apiKey"] },
          contributes: { settings: z.object({ apiKey: z.string() }) },
          async init(ctx) {
            await atInit?.(ctx as never);
          },
        });
      await migrateFor(BUILD_COLLECTIONS, [
        plugin(async ctx => {
          await (
            ctx.settings as { set(v: { apiKey: string }): Promise<void> }
          ).set({ apiKey: storedValue });
          await ctx.security.digests.digest("email", "ada@example.com");
          digested = true;
        }),
      ]);
      expect(digested).toBe(true);
      const before = await structure();

      const previous = process.env.NEXTLY_SECRET ?? "";
      vi.stubEnv("NEXTLY_SECRET_PREVIOUS", previous);
      vi.stubEnv(
        "NEXTLY_SECRET",
        "nextly-test-rotated-secret-at-least-32-chars"
      );
      const { calls, refusal } = await buildStart([plugin()], false);

      expect(refusal).toBeUndefined();
      const writes = writesIn(calls);
      // The plugin's settings, sealed again before it starts, and nothing
      // else: no digest key sealed again in `nextly_meta`.
      expect(
        writes.filter(write => /\bnextly_plugin_settings\b/.test(write))
      ).not.toEqual([]);
      expect(
        writes.filter(write => !/\bnextly_plugin_settings\b/.test(write))
      ).toEqual([]);
      expect(await structure()).toEqual(before);
    }, 240_000);
  }
);
