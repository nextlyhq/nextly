/**
 * A production start changes no table, and refuses a database with no Nextly
 * tables, on every configured dialect.
 *
 * In production the database's structure arrives through `nextly migrate` (or
 * the migrations at start, where an app turns them on), never through a start:
 * several cold starts against one database would otherwise race to change it,
 * and a build older or newer than the one that migrated it would change it to
 * its own shape.
 *
 * Each case migrates a database of its own for one configuration (as a
 * deployment that ran `nextly migrate` and started once has it), changes it so
 * that a start which still defined the structure would have something to do,
 * then starts Nextly in production through its real entry points (`getNextly`,
 * then a request through the route handlers, whose first read of the schema
 * version loads the definitions again), never the test harness, which syncs as
 * a development start does. The database's catalog is read before and after:
 * every schema, table, column, index and constraint.
 *
 * What a start that changed structure would find to do:
 * - a collection and a Single whose tables are gone, and a collection, a
 *   Single and a field group the configuration declares and no migration made;
 * - a translated Builder collection whose translation table is gone;
 * - a collection whose `dbName` changed since it was migrated;
 * - a user field no migration made a column for;
 * - a plugin field extending a Builder collection.
 *
 * And against a database with no Nextly tables, with migrations at start off,
 * the start creates nothing and refuses with the one message naming
 * `nextly migrate`. With migrations at start on, that step sets the database
 * up and the start goes on.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../__tests__/helpers/fresh-database";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  defineSingle,
  text,
} from "../../config";
import { createAdapter } from "../../database/factory";
import { shutdownServices } from "../../di/register";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { recordPluginLifecycle } from "../../domains/schema/ownership/plugin-lifecycle-state";
import { getNextly, shutdownNextly, startSettled } from "../../init";
import { seedBuilderCollection } from "../../plugins/__tests__/seed-builder-entity";
import { definePlugin } from "../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { resetDispatcherForTests } from "../../route-handler/auth-handler";
import { createDynamicHandlers } from "../../routeHandler";
import { _resetEnvCache } from "../../shared/lib/env";
import { sanitizeConfig } from "../../shared/types/config";

/** Readable by anyone, so a request reads the entries as a visitor. */
const READABLE = { read: () => true };

/** The plugin that extends the Builder collection `pscn_articles`. */
const EXTENDING_PLUGIN = "@test/pscn-extend";

/** A plugin adding `pscn_meta` to the Builder collection `pscn_articles`. */
function extendingPlugin() {
  return definePlugin({
    name: EXTENDING_PLUGIN,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      extend: [
        { target: "pscn_articles", fields: [text({ name: "pscn_meta" })] },
      ],
    },
  });
}

/**
 * The configuration's entities: as the database was migrated for them, or as
 * the build that starts declares them, with the posts table under a new
 * `dbName` and a collection, a Single and a field group no migration made.
 */
function entities(starting: boolean) {
  return {
    collections: [
      defineCollection({
        slug: "pscn_posts",
        dbName: starting ? "pscn_posts_renamed" : "pscn_posts_first",
        fields: [text({ name: "title" })],
        access: READABLE,
      }),
      defineCollection({
        slug: "pscn_kept",
        fields: [text({ name: "title" })],
        access: READABLE,
      }),
      ...(starting
        ? [
            defineCollection({
              slug: "pscn_new",
              fields: [text({ name: "title" })],
              access: READABLE,
            }),
          ]
        : []),
    ],
    singles: [
      defineSingle({
        slug: "pscn_banner",
        fields: [text({ name: "title" })],
        access: READABLE,
      }),
      ...(starting
        ? [
            defineSingle({
              slug: "pscn_new_single",
              fields: [text({ name: "title" })],
              access: READABLE,
            }),
          ]
        : []),
    ],
    fieldGroups: starting
      ? [
          defineFieldGroup({
            slug: "pscn_new_group",
            fields: [text({ name: "caption" })],
          }),
        ]
      : [],
  };
}

/**
 * Every schema, table, column, index and constraint the database holds, one
 * line each and sorted, read through a connection of the test's own.
 */
async function catalog(dialect: TestDialect, url: string): Promise<string[]> {
  if (dialect === "sqlite") {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(url.replace(/^file:/, ""), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      // Each table's and index's own definition, which a column added, a
      // table renamed or an index created changes.
      const rows = db
        .prepare(
          "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
        )
        .all() as Array<Record<string, unknown>>;
      return rows.map(row => JSON.stringify(row)).sort();
    } finally {
      db.close();
    }
  }
  if (dialect === "postgresql") {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    try {
      const outside = "NOT IN ('pg_catalog', 'information_schema', 'pg_toast')";
      const queries = [
        `SELECT 'schema' AS kind, nspname AS name FROM pg_namespace
           WHERE nspname ${outside} AND nspname NOT LIKE 'pg\\_temp%' AND nspname NOT LIKE 'pg\\_toast\\_temp%'`,
        `SELECT 'table' AS kind, table_schema, table_name, table_type FROM information_schema.tables
           WHERE table_schema ${outside}`,
        `SELECT 'column' AS kind, table_schema, table_name, column_name, data_type, is_nullable, column_default
           FROM information_schema.columns WHERE table_schema ${outside}`,
        `SELECT 'index' AS kind, schemaname, tablename, indexname, indexdef FROM pg_indexes
           WHERE schemaname ${outside}`,
        `SELECT 'constraint' AS kind, n.nspname, c.conname, c.conrelid::regclass::text AS on_table,
             pg_get_constraintdef(c.oid) AS def
           FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
           WHERE n.nspname ${outside}`,
      ];
      const lines: string[] = [];
      for (const query of queries) {
        const { rows } = await pool.query(query);
        for (const row of rows) lines.push(JSON.stringify(row));
      }
      return lines.sort();
    } finally {
      await pool.end();
    }
  }
  const { createPool } = await import("mysql2");
  const pool = createPool({ uri: url });
  try {
    const queries = [
      `SELECT 'table' AS kind, TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()`,
      `SELECT 'column' AS kind, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`,
      `SELECT 'index' AS kind, TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
         FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()`,
      `SELECT 'constraint' AS kind, TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
         FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE()`,
      `SELECT 'reference' AS kind, TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, DELETE_RULE
         FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()`,
    ];
    const lines: string[] = [];
    for (const query of queries) {
      const [rows] = await pool.promise().query(query);
      for (const row of rows as unknown[]) lines.push(JSON.stringify(row));
    }
    return lines.sort();
  } finally {
    await new Promise<void>(resolve => pool.end(() => resolve()));
  }
}

describe.each(getConfiguredTestDialects())(
  "a production start changes no table (%s)",
  (dialect: TestDialect) => {
    let url: string;
    let drop: () => Promise<void>;
    let migrationsDir: string;

    const adapterFor = (): Promise<DrizzleAdapter> =>
      createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]) as Promise<DrizzleAdapter>;

    beforeEach(async () => {
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-pscn-migrations-"));
      if (dialect === "sqlite") {
        const dir = mkdtempSync(join(tmpdir(), "nextly-pscn-"));
        url = `file:${join(dir, "start.db")}`;
        drop = async () => rmSync(dir, { recursive: true, force: true });
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_pscn");
        url = scratch.url;
        drop = scratch.drop;
      }
      // The start opens the database the environment names.
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      // A production start validates its address before it opens the database.
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
      vi.stubEnv("NODE_ENV", "test");
      _resetEnvCache();
    }, 180_000);

    afterEach(async () => {
      await shutdownNextly();
      await shutdownServices();
      resetDispatcherForTests();
      vi.unstubAllEnvs();
      _resetEnvCache();
      await drop();
      rmSync(migrationsDir, { recursive: true, force: true });
    });

    /** Start in production with `config`, then serve one request. */
    async function productionStart(config: never): Promise<void> {
      vi.stubEnv("NODE_ENV", "production");
      _resetEnvCache();
      try {
        await getNextly({ config });
        // The first request reads the stored schema version and loads the
        // definitions again from the registry rows.
        const handlers = createDynamicHandlers({ config });
        const path = ["collections", "pscn_kept", "entries"];
        await handlers.GET(
          new Request(`http://localhost/api/${path.join("/")}`),
          { params: Promise.resolve({ params: path }) }
        );
        await startSettled();
      } finally {
        await shutdownNextly();
        await shutdownServices();
        resetDispatcherForTests();
      }
    }

    it("leaves every schema, table, column, index and constraint as it found them", async () => {
      // Migrated for the earlier shape, with a Builder collection a plugin
      // extends and a translated Builder collection, as a deployment has it.
      const setup = await adapterFor();
      await createTestNextly({
        adapter: setup as never,
        ...entities(false),
      });
      await seedBuilderCollection(setup, {
        slug: "pscn_articles",
        fields: [{ name: "body", type: "text" }],
      });
      await seedBuilderCollection(setup, {
        slug: "pscn_guides",
        fields: [{ name: "summary", type: "text" }],
        localized: true,
      });
      // Installed, as `nextly plugins install` records it, so the start
      // serves it rather than refusing it.
      await recordPluginLifecycle(
        new SchemaEventsRepository(setup.getDrizzle(), dialect),
        EXTENDING_PLUGIN,
        { state: "installed" }
      );
      await shutdownServices();
      await setup.disconnect().catch(() => undefined);

      // What a start that changed structure would have to put back.
      const check = await adapterFor();
      const existing = new Set(
        (await check.listTables()).map(name => name.toLowerCase())
      );
      for (const table of [
        "dc_pscn_kept",
        "single_pscn_banner",
        "dc_pscn_guides_locales",
        "dc_pscn_posts_first",
      ]) {
        expect(existing, `${table} was migrated`).toContain(table);
      }
      await check.executeQuery("DROP TABLE dc_pscn_guides_locales");
      await check.executeQuery("DROP TABLE dc_pscn_kept");
      await check.executeQuery("DROP TABLE single_pscn_banner");
      await check.disconnect().catch(() => undefined);

      const before = await catalog(dialect, url);

      await productionStart(
        sanitizeConfig(
          defineConfig({
            ...entities(true),
            users: { fields: [text({ name: "pscn_nickname" })] },
            plugins: [extendingPlugin()],
          })
        ) as never
      );

      expect(await catalog(dialect, url)).toEqual(before);
    }, 300_000);

    it("refuses a database with no Nextly tables, creating nothing", async () => {
      if (dialect === "sqlite") {
        // A database that exists and holds no table.
        const { default: Database } = await import("better-sqlite3");
        new Database(url.replace(/^file:/, "")).close();
      }
      const before = await catalog(dialect, url);

      vi.stubEnv("NODE_ENV", "production");
      _resetEnvCache();
      const started = getNextly({
        config: sanitizeConfig(defineConfig(entities(false))) as never,
      });

      await expect(started).rejects.toMatchObject({
        code: "NEXTLY_DATABASE_NOT_SET_UP",
        message: expect.stringContaining("nextly migrate"),
      });
      await shutdownNextly();
      await shutdownServices();
      expect(await catalog(dialect, url)).toEqual(before);
    }, 240_000);

    it.runIf(dialect === "postgresql")(
      "refuses a database without the configured PostgreSQL schema, creating none",
      async () => {
        // The schema the tables would live in, configured and not there.
        const { Pool } = await import("pg");
        const pool = new Pool({ connectionString: url });
        await pool.query("DROP SCHEMA public CASCADE");
        await pool.end();
        const before = await catalog(dialect, url);
        expect(before.join("\n")).not.toContain('"name":"public"');

        vi.stubEnv("NODE_ENV", "production");
        _resetEnvCache();
        const started = getNextly({
          config: sanitizeConfig(
            defineConfig({
              ...entities(false),
              db: { postgres: { schema: "public" } },
            })
          ) as never,
        });

        await expect(started).rejects.toMatchObject({
          code: "NEXTLY_DATABASE_NOT_SET_UP",
          message: expect.stringContaining("nextly migrate"),
        });
        await shutdownNextly();
        await shutdownServices();
        expect(await catalog(dialect, url)).toEqual(before);
      },
      240_000
    );

    it("the control: with migrations at start on, that step sets an empty database up and the start goes on", async () => {
      vi.stubEnv("NODE_ENV", "production");
      _resetEnvCache();
      await getNextly({
        config: sanitizeConfig(
          defineConfig({
            ...entities(false),
            db: { runMigrationsOnBoot: true, migrationsDir },
          })
        ) as never,
      });
      await startSettled();
      await shutdownNextly();
      await shutdownServices();

      const tables = (await catalog(dialect, url)).join("\n");
      expect(tables).toContain("nextly_schema_events");
      expect(tables).toContain("dynamic_collections");
    }, 240_000);
  }
);
