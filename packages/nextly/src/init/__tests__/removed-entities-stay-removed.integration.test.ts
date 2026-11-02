/**
 * A collection or Single removed from code stays as it was through a
 * development start, a configuration reload and a `next build`, on every
 * configured dialect.
 *
 * "Removed from code" is a registry row whose source is the app's code for a
 * slug the configuration no longer declares. Nothing outside a migration may
 * bring its tables back, change them, or change its registry row: a migration
 * that dropped them would otherwise be undone, empty, by the next start. A
 * Builder entity is not removed from code by being absent from the
 * configuration, so its missing table is still created in development, as
 * before: a Builder Single's by the start, a Builder collection's by the first
 * reload that applies schema.
 *
 * Each case boots the app with the entities declared, removes them from the
 * configuration, and then runs the three steps against the same database:
 *
 * - the development start: `registerServices` and the boot's schema apply, as
 *   `getNextly()` runs them under `next dev`;
 * - a configuration reload, carrying an edit to a declared collection so the
 *   reload has schema to apply;
 * - the boot `next build` runs while it collects page data.
 *
 * The second case records every statement those steps send to the driver.
 * The recorder is installed on the driver itself, below the adapter, the
 * Drizzle handle and drizzle-kit, so a statement cannot reach the database
 * without passing it; a positive control shows it seeing the hand-written
 * ALTER that sets the case up.
 *
 * Only reading the configuration file is replaced, as in the other reload
 * tests: compiling it imports the result through Node's loader, which Vitest's
 * module runner cannot do.
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineConfig,
  defineSingle,
  relationship,
  text,
} from "../../config";
import { createAdapter } from "../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../database/test-database-ddl";
import { clearServices, shutdownServices } from "../../di/register";
import {
  seedBuilderCollection,
  seedBuilderSingle,
} from "../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../plugins/test-nextly";
import { _resetEnvCache } from "../../shared/lib/env";
import { runBootTimeApplyIfDev } from "../boot-apply";
import { reloadNextlyConfig } from "../reload-config";

/** What the config file says now: what `loadConfig` returns for it. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

const LOCALIZATION = { locales: ["en", "de"], defaultLocale: "en" };

/** Stays declared throughout: the target of both many-to-many fields. */
const tags = defineCollection({
  slug: "rr_tags",
  fields: [text({ name: "name" })],
});

/** The same collection with a field added: the edit the reload applies. */
const tagsEdited = defineCollection({
  slug: "rr_tags",
  fields: [text({ name: "name" }), text({ name: "note" })],
});

/**
 * Stays declared throughout. A start reconciles the Singles' tables only when
 * the configuration declares one, so an app with none would not reach that
 * step at all.
 */
const kept = defineSingle({
  slug: "rr_kept",
  fields: [text({ name: "motto" })],
});

/** Removed from code: translated, with a many-to-many field. */
const posts = defineCollection({
  slug: "rr_posts",
  localized: true,
  fields: [
    text({ name: "title", localized: false }),
    text({ name: "headline" }),
    relationship({ name: "topics", relationTo: "rr_tags", hasMany: true }),
  ],
});

/** Removed from code: translated, with a many-to-many field. */
const banner = defineSingle({
  slug: "rr_banner",
  localized: true,
  fields: [
    text({ name: "campaign", localized: false }),
    text({ name: "message" }),
    relationship({ name: "topics", relationTo: "rr_tags", hasMany: true }),
  ],
});

interface Declared {
  collections: ReturnType<typeof defineCollection>[];
  singles: ReturnType<typeof defineSingle>[];
}

const WITH_REMOVED: Declared = {
  collections: [tags, posts],
  singles: [kept, banner],
};
const AFTER_REMOVAL: Declared = { collections: [tags], singles: [kept] };
const AFTER_EDIT: Declared = { collections: [tagsEdited], singles: [kept] };

/** Every table the two removed entities own, as their declaration makes them. */
const OWNED = [
  "dc_rr_posts",
  "dc_rr_posts_locales",
  "single_rr_banner",
  "single_rr_banner_locales",
];

/** What a production boot requires. A throwaway secret for this boot alone. */
const PRODUCTION_BUILD: Record<string, string> = {
  NODE_ENV: "production",
  NEXT_PHASE: "phase-production-build",
  NEXTLY_SECRET: "test-only-secret-for-the-boot-gate-0123456789",
  NEXT_PUBLIC_APP_URL: "http://localhost",
};

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

/**
 * A database every boot of one case connects to.
 *
 * The harness's own provisioning drops its database at the next boot, and a
 * restart has to find the tables the previous boot left. So the case owns the
 * database: a throwaway one on PostgreSQL and MySQL, and one in-memory SQLite
 * connection that every boot reuses.
 */
interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const adapter = (await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return { adapter, close: () => adapter.disconnect() };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_rr_${randomBytes(8).toString("hex")}`;
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  const server = await createAdapter({ type: dialect, url: serverUrl });
  await server.executeQuery(createDatabaseStatement(dialect, name));
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  // The reload reads the MySQL database name from here, as an app's does.
  vi.stubEnv("DATABASE_URL", url.toString());
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: dialect,
    url: url.toString(),
  })) as unknown as DrizzleAdapter;
  return {
    adapter,
    async close() {
      await adapter.disconnect().catch(() => {});
      await server.executeQuery(dropDatabaseStatement(dialect, name));
      await server.disconnect();
    },
  };
}

/** The statement text a driver call carries, whatever form it was passed in. */
function statementText(arg: unknown): string | undefined {
  if (typeof arg === "string") return arg;
  if (arg && typeof arg === "object") {
    const shaped = arg as { text?: unknown; sql?: unknown };
    if (typeof shaped.text === "string") return shaped.text;
    if (typeof shaped.sql === "string") return shaped.sql;
  }
  return undefined;
}

/** The prototype in `start`'s chain that defines `method` itself. */
function ownerOf(start: object, method: string): Record<string, unknown> {
  let proto: object | null = start;
  while (proto && !Object.prototype.hasOwnProperty.call(proto, method)) {
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  if (!proto) throw new Error(`no ${method} on the driver`);
  return proto as Record<string, unknown>;
}

/**
 * Record every statement the driver under `adapter` is handed.
 *
 * Patched on the driver's prototype, which every connection of the pool shares:
 * `pg`'s client `query`, `mysql2`'s connection `query` and `execute`, and
 * `better-sqlite3`'s `prepare` and `exec`.
 */
async function recordStatements(
  adapter: DrizzleAdapter,
  dialect: TestDialect
): Promise<{ statements: string[]; uninstall(): void }> {
  const client = (adapter.getDrizzle() as { $client: unknown }).$client;
  let instance: object;
  let methods: string[];
  if (dialect === "postgresql") {
    const pool = client as {
      connect(): Promise<{ release(): void } & object>;
    };
    const connection = await pool.connect();
    connection.release();
    instance = connection;
    methods = ["query"];
  } else if (dialect === "mysql") {
    // The callback pool, which the promise wrapper carries as `pool`.
    type CorePool = {
      getConnection(
        callback: (error: unknown, connection: { release(): void }) => void
      ): void;
    };
    const wrapped = client as { pool?: CorePool };
    const pool = wrapped.pool ?? (client as CorePool);
    const connection = await new Promise<{ release(): void } & object>(
      (resolve, reject) =>
        pool.getConnection((error, conn) =>
          error ? reject(error) : resolve(conn)
        )
    );
    connection.release();
    instance = connection;
    methods = ["query", "execute"];
  } else {
    instance = client as object;
    methods = ["prepare", "exec"];
  }

  const statements: string[] = [];
  const restores: Array<() => void> = [];
  for (const method of methods) {
    const owner = ownerOf(instance, method);
    const original = owner[method] as (...args: unknown[]) => unknown;
    owner[method] = function (this: unknown, ...args: unknown[]): unknown {
      const text = statementText(args[0]);
      if (text !== undefined) statements.push(text);
      return original.apply(this, args);
    };
    restores.push(() => {
      owner[method] = original;
    });
  }
  return {
    statements,
    uninstall: () => restores.forEach(restore => restore()),
  };
}

/** Whether `statement` creates, alters, renames or drops `table`. */
function changesTable(statement: string, table: string): boolean {
  const named = new RegExp(`(^|[^A-Za-z0-9_])${table}([^A-Za-z0-9_]|$)`, "i");
  // A SQLite rebuild works on a copy under this name and renames it back.
  const rebuilt = new RegExp(`__new_${table}([^A-Za-z0-9_]|$)`, "i");
  if (rebuilt.test(statement)) return true;
  return (
    /^\s*(CREATE|ALTER|DROP|RENAME)\b/i.test(statement) && named.test(statement)
  );
}

/** Every column `table` has, sorted. */
async function columnsOf(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  table: string
): Promise<string[]> {
  const sql =
    dialect === "sqlite"
      ? `SELECT name AS name FROM pragma_table_info('${table}')`
      : dialect === "postgresql"
        ? `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}' AND table_schema = current_schema()`
        : `SELECT column_name AS name FROM information_schema.columns WHERE table_name = '${table}' AND table_schema = DATABASE()`;
  const rows = (await adapter.executeQuery(sql)) as Array<{
    name?: string;
    NAME?: string;
  }>;
  return rows.map(row => String(row.name ?? row.NAME)).sort();
}

/** The registry row for `slug`, every column of it. */
async function registryRow(
  adapter: DrizzleAdapter,
  registry: "dynamic_collections" | "dynamic_singles",
  slug: string
): Promise<Record<string, unknown> | undefined> {
  const rows = (await adapter.executeQuery(
    `SELECT * FROM ${registry} WHERE slug = '${slug}'`
  )) as Array<Record<string, unknown>>;
  return rows[0];
}

/**
 * The tables an entity owns, read from the live database: its main table, its
 * translation table, and every many-to-many join table whose name the main
 * table's starts or ends.
 */
async function ownedTables(
  adapter: DrizzleAdapter,
  main: string
): Promise<string[]> {
  const live = await adapter.listTables();
  return live
    .filter(
      name =>
        name === main ||
        name === `${main}_locales` ||
        (name !== main &&
          !name.endsWith("_locales") &&
          (name.startsWith(`${main}_`) || name.includes(`_${main}_`)))
    )
    .sort();
}

describe.each(getConfiguredTestDialects())(
  "a collection and a Single removed from code (%s)",
  dialect => {
    let database: CaseDatabase;

    /** Boot as a start does, with `declared` as the configuration's entities. */
    async function boot(declared: Declared): Promise<void> {
      clearServices();
      loaded.config = defineConfig({
        collections: declared.collections,
        singles: declared.singles,
        localization: LOCALIZATION,
      });
      await createTestNextly({
        adapter: database.adapter as never,
        collections: declared.collections,
        singles: declared.singles,
        localization: LOCALIZATION,
      });
    }

    /** A development start: the boot, then its schema apply. */
    async function developmentStart(declared: Declared): Promise<void> {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PHASE", "");
      await boot(declared);
      await runBootTimeApplyIfDev({ caller: "test" });
    }

    /** A configuration reload of `declared`, as a saved edit triggers it. */
    async function configurationReload(declared: Declared): Promise<void> {
      vi.stubEnv("NODE_ENV", "development");
      loaded.config = defineConfig({
        collections: declared.collections,
        singles: declared.singles,
        localization: LOCALIZATION,
      });
      await reloadNextlyConfig();
    }

    /** The boot `next build` runs while it collects page data. */
    async function nextBuild(declared: Declared): Promise<void> {
      for (const [key, value] of Object.entries(PRODUCTION_BUILD)) {
        vi.stubEnv(key, value);
      }
      await boot(declared);
    }

    /** Every table the removed collection and Single own. */
    async function removedTables(): Promise<string[]> {
      return [
        ...(await ownedTables(database.adapter, "dc_rr_posts")),
        ...(await ownedTables(database.adapter, "single_rr_banner")),
      ];
    }

    beforeEach(async () => {
      database = await openDatabase(dialect);
      // The app as it was, with both entities declared, after a development
      // start has created everything they own.
      await developmentStart(WITH_REMOVED);
    });

    afterEach(async () => {
      await shutdownServices().catch(() => {});
      vi.unstubAllEnvs();
      _resetEnvCache();
      await database?.close();
    });

    it("recreates none of their tables once a migration has dropped them", async () => {
      // Positive control: the fixture reached what it is about. Each entity
      // had its main and translation table; a many-to-many declared in code
      // keeps its links in a column of the main table, so there is no join
      // table, and `ownedTables` would list one if there were.
      expect(await removedTables()).toEqual(OWNED);

      // Two Builder entities, whose tables a development start creates again.
      await seedBuilderCollection(database.adapter, {
        slug: "rr_drafts",
        fields: [{ name: "body", type: "text" }],
      });
      await seedBuilderSingle(database.adapter, {
        slug: "rr_notice",
        fields: [{ name: "body", type: "text" }],
      });

      // Removed from the configuration, and every table they own dropped, as
      // an applied drop migration leaves them; the Builder ones dropped too.
      for (const table of [
        "dc_rr_posts_locales",
        "single_rr_banner_locales",
        "dc_rr_posts",
        "single_rr_banner",
        "dc_rr_drafts",
        "single_rr_notice",
      ]) {
        await database.adapter.executeQuery(`DROP TABLE ${table}`);
      }
      expect(await removedTables()).toEqual([]);

      // The Builder's entities keep today's development behaviour: a start
      // creates a Builder Single's missing table, and the first reload that
      // applies schema creates a Builder collection's, from its stored fields.
      await developmentStart(AFTER_REMOVAL);
      expect(await removedTables()).toEqual([]);
      expect(await database.adapter.tableExists("single_rr_notice")).toBe(true);

      await configurationReload(AFTER_EDIT);
      expect(await removedTables()).toEqual([]);
      expect(await database.adapter.tableExists("dc_rr_drafts")).toBe(true);
      // The reload applied the declared collection's edit.
      expect(
        await columnsOf(database.adapter, dialect, "dc_rr_tags")
      ).toContain("note");

      await nextBuild(AFTER_EDIT);
      expect(await removedTables()).toEqual([]);
    });

    it("changes none of their tables, and neither registry row, while the tables are kept", async () => {
      const owned = await removedTables();
      expect(owned).toEqual(OWNED);

      // Each table made to differ from what its registry row describes.
      const recorder = await recordStatements(database.adapter, dialect);
      try {
        for (const table of owned) {
          await database.adapter.executeQuery(
            `ALTER TABLE ${table} ADD COLUMN rr_by_hand varchar(40)`
          );
        }
        // Positive control: the recorder sees what reaches the driver.
        for (const table of owned) {
          expect(
            recorder.statements.some(statement =>
              changesTable(statement, table)
            )
          ).toBe(true);
        }
      } finally {
        recorder.uninstall();
      }

      const columnsBefore = new Map<string, string[]>();
      for (const table of owned) {
        columnsBefore.set(
          table,
          await columnsOf(database.adapter, dialect, table)
        );
      }
      const rowsBefore = {
        collection: await registryRow(
          database.adapter,
          "dynamic_collections",
          "rr_posts"
        ),
        single: await registryRow(
          database.adapter,
          "dynamic_singles",
          "rr_banner"
        ),
      };
      expect(rowsBefore.collection).toBeDefined();
      expect(rowsBefore.single).toBeDefined();

      const recorded = await recordStatements(database.adapter, dialect);
      try {
        await developmentStart(AFTER_REMOVAL);
        await configurationReload(AFTER_EDIT);
        await nextBuild(AFTER_EDIT);
      } finally {
        recorded.uninstall();
      }

      // The reload applied the declared collection's edit, so the recording
      // holds the statements of a real apply.
      expect(
        recorded.statements.some(statement =>
          changesTable(statement, "dc_rr_tags")
        )
      ).toBe(true);
      const touching = recorded.statements.filter(statement =>
        owned.some(table => changesTable(statement, table))
      );
      expect(touching).toEqual([]);
      for (const table of owned) {
        expect(await columnsOf(database.adapter, dialect, table)).toEqual(
          columnsBefore.get(table)
        );
      }
      expect({
        collection: await registryRow(
          database.adapter,
          "dynamic_collections",
          "rr_posts"
        ),
        single: await registryRow(
          database.adapter,
          "dynamic_singles",
          "rr_banner"
        ),
      }).toEqual(rowsBefore);
    });
  }
);
