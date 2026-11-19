/**
 * A site whose field-group storage is driven across a storage migration and restarts, for the
 * suites that judge which names each path uses before and after it.
 *
 * Each case owns its database, because a restart has to find what the previous start left: a
 * throwaway database on PostgreSQL and MySQL, and one in-memory SQLite connection every start
 * reuses. The harness's own provisioning drops its database at the next boot, so it cannot serve
 * a case that starts more than once.
 *
 * The suites mock `cli/utils/config-loader` themselves (a `vi.mock` is hoisted per file) and hand
 * the mocked config holder in through {@link SiteOptions.loaded}.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { vi } from "vitest";

import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../../database/test-database-ddl";
import { clearServices } from "../../../../di/register";
import { runBootTimeApplyIfDev } from "../../../../init/boot-apply";
import { reloadNextlyConfig } from "../../../../init/reload-config";
import { clearCachedSnapshot } from "../../../../init/schema-snapshot-cache";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { PluginDefinition } from "../../../../plugins/plugin-context";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { MetaService } from "../../../meta/services/meta-service";
import { runFieldGroupMigration } from "../../migration/run";
import { readMigrationState } from "../../migration/state";
import { forgetFieldGroupStorageNames } from "../../storage/resolve-storage-names";

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

/** What the mocked config loader returns: the suite owns the holder, this module fills it. */
export interface LoadedConfig {
  config: unknown;
}

/** The entities a start declares. */
export interface Declared {
  collections: ReturnType<typeof defineCollection>[];
  fieldGroups: ReturnType<typeof defineFieldGroup>[];
}

export interface SiteOptions {
  dialect: TestDialect;
  loaded: LoadedConfig;
  localization?: { locales: string[]; defaultLocale: string };
  /**
   * Set the database up as a release from before the current names left it: the core tables with
   * the legacy `dynamic_components` registry, before the first start. Without it the database is
   * empty and the first start sets up a new site.
   */
  legacy?: boolean;
  /** Plugins every start boots, as the app config lists them. */
  plugins?: PluginDefinition[];
}

/**
 * The core tables as an earlier release created them: the dialect's table bundle as declared,
 * which names the legacy registry. The first start then finds a database already set up and keeps
 * the storage it holds, as it does for every site that predates the current names.
 */
async function seedLegacyCoreTables(
  adapter: DrizzleAdapter,
  dialect: TestDialect
): Promise<void> {
  const [{ loadDialectTables }, { getDialectTables }, { freshPushSchema }] =
    await Promise.all([
      import("../../../../database/dialect-tables"),
      import("../../../../database/index"),
      import("../../../schema/pipeline/fresh-push"),
    ]);
  await loadDialectTables(dialect);
  const bundle = getDialectTables(dialect) as Record<string, unknown>;
  if (!("dynamicFieldGroups" in bundle)) {
    throw new Error(
      "the dialect bundle no longer declares the field-group registry"
    );
  }
  await freshPushSchema(dialect, adapter.getDrizzle(), bundle);
}

const SILENT = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** A logger that keeps every line, so a suite can ask what a start said. */
export function recordingLogger(): {
  logger: typeof SILENT;
  lines: string[];
} {
  const lines: string[] = [];
  const keep =
    () =>
    (...args: unknown[]): void => {
      lines.push(
        args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")
      );
    };
  return {
    lines,
    logger: { debug: keep(), info: keep(), warn: keep(), error: keep() },
  };
}

export interface StorageGenerationSite {
  adapter: DrizzleAdapter;
  /** The instance the last start made. */
  readonly current: TestNextly | undefined;
  /** A development start: the boot, then its schema apply, as `next dev` runs them. */
  developmentStart(
    declared: Declared,
    logger?: typeof SILENT,
    /** Plugins this start boots, in place of the site's own. */
    plugins?: PluginDefinition[]
  ): Promise<TestNextly>;
  /** A configuration reload of `declared`, as a saved edit triggers it. */
  configurationReload(declared: Declared): Promise<void>;
  /** `migrate:field-groups --apply --backup-confirmed`, or its preview. */
  migrateStorage(options?: {
    dryRun?: boolean;
  }): Promise<{ reason?: string; ran: boolean }>;
  /** The storage migration's marker, as the migration reads it. */
  marker(): Promise<Awaited<ReturnType<typeof readMigrationState>>>;
  close(): Promise<void>;
}

async function openDatabase(
  dialect: TestDialect
): Promise<{ adapter: DrizzleAdapter; close(): Promise<void> }> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const adapter = (await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    // Disconnected once by the instance's own teardown already, where one ran.
    return { adapter, close: () => adapter.disconnect().catch(() => {}) };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_fgsn_${randomBytes(8).toString("hex")}`;
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

export async function openStorageGenerationSite(
  options: SiteOptions
): Promise<StorageGenerationSite> {
  const { dialect, loaded, localization, plugins } = options;
  const database = await openDatabase(dialect);
  if (options.legacy === true) {
    await seedLegacyCoreTables(database.adapter, dialect);
  }
  // One project folder for every start, as an app's is: the migrations a Builder save writes at
  // one start are the ones the ledger records, and the next start reads them from here.
  const basePath = await mkdtemp(join(tmpdir(), "nextly-fgsn-"));
  let current: TestNextly | undefined;

  const configOf = (declared: Declared) =>
    defineConfig({
      collections: declared.collections,
      fieldGroups: declared.fieldGroups,
      ...(localization ? { localization } : {}),
      ...(plugins ? { plugins } : {}),
    });

  return {
    adapter: database.adapter,
    get current() {
      return current;
    },
    async developmentStart(declared, logger, startPlugins) {
      const bootPlugins = startPlugins ?? plugins;
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("NEXT_PHASE", "");
      clearServices();
      clearCachedSnapshot();
      // A start is a new process: nothing an earlier one resolved about storage survives it.
      forgetFieldGroupStorageNames();
      loaded.config = configOf(declared);
      current = await createTestNextly({
        adapter: database.adapter as never,
        collections: declared.collections,
        fieldGroups: declared.fieldGroups,
        ...(localization ? { localization } : {}),
        ...(bootPlugins ? { plugins: bootPlugins } : {}),
        ...(logger ? { logger: logger as never } : {}),
        basePath,
      });
      await runBootTimeApplyIfDev({ caller: "test" });
      return current;
    },
    async configurationReload(declared) {
      vi.stubEnv("NODE_ENV", "development");
      loaded.config = configOf(declared);
      await reloadNextlyConfig();
    },
    async migrateStorage({ dryRun = false } = {}) {
      const outcome = await runFieldGroupMigration({
        adapter: database.adapter,
        logger: SILENT as never,
        direction: "up",
        dryRun,
        // The suite creates and drops this database itself.
        backupConfirmed: true,
      });
      // The process that migrated drops what it resolved before storage moved.
      forgetFieldGroupStorageNames();
      return outcome as { reason?: string; ran: boolean };
    },
    async marker() {
      return readMigrationState(
        new MetaService(database.adapter, SILENT as never)
      );
    },
    async close() {
      // The live instance first, so a plugin's teardown runs while its database is still there.
      await current?.destroy().catch(() => {});
      clearServices();
      await database.close();
      await rm(basePath, { recursive: true, force: true });
    },
  };
}

/** Every table the live database holds, lowercased. */
async function liveTables(adapter: DrizzleAdapter): Promise<string[]> {
  return (await adapter.listTables()).map(name => name.toLowerCase()).sort();
}

/** Every column `table` has, lowercased and sorted. */
export async function columnsOf(
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
  return rows.map(row => String(row.name ?? row.NAME).toLowerCase()).sort();
}

/**
 * Everything in the live database that carries a legacy field-group name: a `comp_` table, the
 * `dynamic_components` registry, and a `_component_type` column on any field-group table.
 * Empty on a site whose storage is entirely on the current names.
 */
export async function legacyObjects(
  adapter: DrizzleAdapter,
  dialect: TestDialect
): Promise<string[]> {
  const found: string[] = [];
  for (const table of await liveTables(adapter)) {
    if (table === "dynamic_components" || table.startsWith("comp_")) {
      found.push(table);
      continue;
    }
    if (table.startsWith("fg_")) {
      if (
        (await columnsOf(adapter, dialect, table)).includes("_component_type")
      ) {
        found.push(`${table}._component_type`);
      }
    }
  }
  return found;
}

/** Whether the live database holds `table`, compared without case. */
export async function hasTable(
  adapter: DrizzleAdapter,
  table: string
): Promise<boolean> {
  return (await liveTables(adapter)).includes(table.toLowerCase());
}

/** The field-group registry row for `slug`, read from `registry` directly. */
export async function registryRowIn(
  adapter: DrizzleAdapter,
  registry: "dynamic_components" | "dynamic_field_groups",
  slug: string
): Promise<{ table_name?: string; fields?: unknown } | undefined> {
  const rows = (await adapter.executeQuery(
    `SELECT * FROM ${registry} WHERE slug = '${slug}'`
  )) as Array<{ table_name?: string; fields?: unknown }>;
  return rows[0];
}

/** The names of the fields a registry row's `fields` holds. */
export function fieldNamesOf(row: { fields?: unknown } | undefined): string[] {
  const raw = row?.fields;
  const list = (typeof raw === "string" ? JSON.parse(raw) : raw) as
    | Array<{ name?: string }>
    | undefined;
  return (list ?? []).map(field => String(field.name)).sort();
}
