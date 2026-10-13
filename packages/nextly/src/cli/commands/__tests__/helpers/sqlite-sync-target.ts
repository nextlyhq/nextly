/**
 * A SQLite file that `nextly db:sync`'s own steps can run against.
 *
 * Connected and prepared the way the command prepares its connection: system
 * tables resolved by name through a schema registry, then the core tables
 * ensured. What a test then runs (`syncCollections`, `syncSingles` and so on)
 * is the command's real sequence; only the config file is not read from disk.
 */
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { getDialectTables } from "../../../../database/index";
import { createAdapter } from "../../../../database/factory";
import { SchemaRegistry } from "../../../../database/schema-registry";
import type { CommandContext } from "../../../program";
import type { CLIDatabaseAdapter } from "../../../utils/adapter";
import { createLogger } from "../../../utils/logger";
import type { ResolvedDevOptions } from "../../db-sync";
import { ensureCoreTables } from "../../dev-server";

export interface SqliteSyncTarget {
  /** The connection, for reading back what the sync left. */
  adapter: Awaited<ReturnType<typeof createAdapter>>;
  /** The same connection, as the command's steps take it. */
  cli: CLIDatabaseAdapter;
  options: ResolvedDevOptions;
  context: CommandContext;
}

/** Open `test.db` in `dir` and prepare it as `db:sync` prepares its connection. */
export async function openSqliteSyncTarget(
  dir: string
): Promise<SqliteSyncTarget> {
  const adapter = await createAdapter({
    type: "sqlite",
    url: `file:${join(dir, "test.db")}`,
  } as Parameters<typeof createAdapter>[0]);

  const logger = createLogger({ quiet: true });
  const options = { cwd: dir, autoSync: true } as ResolvedDevOptions;
  const context = { logger, options: {}, cwd: dir } as CommandContext;
  // The real adapter is a DrizzleAdapter; `CLIDatabaseAdapter` declares only the
  // handful of methods the command signatures need, so the command file converts
  // between them exactly like this.
  const cli = adapter as unknown as CLIDatabaseAdapter;

  // Without a resolver the ORM cannot address `dynamic_collections`, so the sync
  // fails before it reaches anything a test is about.
  const registry = new SchemaRegistry("sqlite");
  registry.registerStaticSchemas(getDialectTables("sqlite"));
  (adapter as unknown as DrizzleAdapter).setTableResolver(registry);
  await ensureCoreTables(cli, options, context);

  return { adapter, cli, options, context };
}
