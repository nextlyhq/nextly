/**
 * A sync target on any configured dialect, prepared as `db:sync` prepares its
 * own connection: the static schemas registered, the core tables ensured.
 *
 * Beside `sqlite-sync-target`, for the behaviour that differs by dialect.
 * PostgreSQL and MySQL connect to the throwaway database their test URL names;
 * SQLite opens a file under `dir`.
 */
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { getDialectTables } from "../../../../database/index";
import { createAdapter } from "../../../../database/factory";
import { SchemaRegistry } from "../../../../database/schema-registry";
import type { TestDialect } from "../../../../plugins/test-nextly";
import type { CommandContext } from "../../../program";
import type { CLIDatabaseAdapter } from "../../../utils/adapter";
import { createLogger } from "../../../utils/logger";
import type { ResolvedDevOptions } from "../../db-sync";
import { ensureCoreTables } from "../../dev-server";

export interface SyncTarget {
  adapter: Awaited<ReturnType<typeof createAdapter>>;
  cli: CLIDatabaseAdapter;
  options: ResolvedDevOptions;
  context: CommandContext;
  /** Disconnect, and drop the throwaway database a server dialect was given. */
  close: () => Promise<void>;
}

const TYPE = {
  postgresql: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
} as const;

function serverUrl(dialect: "postgresql" | "mysql"): URL {
  const url =
    dialect === "postgresql"
      ? process.env.TEST_POSTGRES_URL
      : process.env.TEST_MYSQL_URL;
  if (!url) throw new Error(`no test database URL for ${dialect}`);
  return new URL(url);
}

/**
 * A database of its own for one test, beside the slot's. A sync reconciles the
 * whole database against the configuration it is given, so tables another test
 * left in a shared one read as removals that need a person to confirm.
 */
export async function throwawayDatabase(
  dialect: "postgresql" | "mysql"
): Promise<{ url: string; drop: () => Promise<void> }> {
  const base = serverUrl(dialect);
  // A fixed length, independent of the slot's name: a suffix on a long base
  // could pass PostgreSQL's 63-byte or MySQL's 64-character limit.
  const name = `nextly_sync_${Math.random().toString(36).slice(2, 12).padEnd(10, "0")}`;
  const quoted = dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  // Validated whenever an adapter is made: a server dialect needs its URL set.
  process.env.DATABASE_URL = base.toString();
  const admin = await createAdapter({
    type: dialect,
    url: base.toString(),
  } as Parameters<typeof createAdapter>[0]);
  await admin.executeQuery(`CREATE DATABASE ${quoted}`);
  await admin.disconnect();
  const own = new URL(base.toString());
  own.pathname = `/${name}`;
  return {
    url: own.toString(),
    drop: async () => {
      const cleanup = await createAdapter({
        type: dialect,
        url: base.toString(),
      } as Parameters<typeof createAdapter>[0]);
      await cleanup.executeQuery(`DROP DATABASE IF EXISTS ${quoted}`);
      await cleanup.disconnect();
    },
  };
}

export async function openSyncTarget(
  dir: string,
  dialect: TestDialect
): Promise<SyncTarget> {
  const own =
    dialect === "sqlite"
      ? { url: `file:${join(dir, "test.db")}`, drop: async () => {} }
      : await throwawayDatabase(dialect);
  // The command reads its connection from the environment as well.
  if (dialect !== "sqlite") process.env.DATABASE_URL = own.url;
  // From here a failure still drops the database it was given, since the
  // caller gets no handle to close.
  let adapter: Awaited<ReturnType<typeof createAdapter>> | undefined;
  try {
    adapter = await createAdapter({
      type: TYPE[dialect],
      url: own.url,
    } as Parameters<typeof createAdapter>[0]);

    const logger = createLogger({ quiet: true });
    const options = { cwd: dir, autoSync: true } as ResolvedDevOptions;
    const context = { logger, options: {}, cwd: dir } as CommandContext;
    const cli = adapter as unknown as CLIDatabaseAdapter;

    // Without a resolver the ORM cannot address `dynamic_collections`, so the
    // sync fails before it reaches anything a test is about.
    const registry = new SchemaRegistry(TYPE[dialect]);
    registry.registerStaticSchemas(getDialectTables(TYPE[dialect]));
    (adapter as unknown as DrizzleAdapter).setTableResolver(registry);
    await ensureCoreTables(cli, options, context);

    const opened = adapter;
    return {
      adapter: opened,
      cli,
      options,
      context,
      close: async () => {
        try {
          await opened.disconnect();
        } finally {
          await own.drop();
        }
      },
    };
  } catch (error) {
    try {
      await adapter?.disconnect();
    } finally {
      await own.drop();
    }
    throw error;
  }
}
