/**
 * `nextly migrate:resolve` — operator recovery command (spec §4.8).
 *
 * Thin CLI shell over `resolveMigration`. Exactly one of --applied /
 * --rolled-back / --failed-cleanup must be supplied. Wrapped in the shared
 * migrate lock (spec §4.6.2). Idempotent operations exit 0 with a message.
 *
 * **Runtime restriction (F11):** CLI-only; never import from runtime code.
 *
 * @module cli/commands/migrate-resolve
 * @since v0.0.3-alpha (Plan C3)
 */
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import {
  resolveMigration,
  type ResolveMode,
} from "../../domains/schema/migrate/resolve";
import { parseSnapshotFile } from "../../domains/schema/migrate-create/snapshot-io";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { CORE_TABLE_PREFIXES } from "../../schemas";
import { createContext, type CommandContext } from "../program";
import {
  createAdapter,
  validateDatabaseEnv,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

interface ResolveCommandOptions {
  applied?: string;
  rolledBack?: string;
  failedCleanup?: string;
  skipVerify?: boolean;
}

interface ResolvedOptions extends ResolveCommandOptions {
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

function pickMode(opts: ResolveCommandOptions): {
  mode: ResolveMode;
  filename: string;
} {
  const chosen = [
    opts.applied !== undefined ? (["applied", opts.applied] as const) : null,
    opts.rolledBack !== undefined
      ? (["rolled-back", opts.rolledBack] as const)
      : null,
    opts.failedCleanup !== undefined
      ? (["failed-cleanup", opts.failedCleanup] as const)
      : null,
  ].filter((x): x is readonly [ResolveMode, string] => x !== null);

  if (chosen.length !== 1) {
    throw new Error(
      "Provide exactly one of --applied, --rolled-back, or --failed-cleanup."
    );
  }
  return { mode: chosen[0][0], filename: chosen[0][1] };
}

async function fileExistsIn(dir: string, filename: string): Promise<boolean> {
  const name = filename.endsWith(".sql") ? filename : `${filename}.sql`;
  try {
    await access(resolve(dir, name));
    return true;
  } catch {
    return false;
  }
}

async function loadSnapshot(
  metaDir: string,
  filename: string
): Promise<NextlySchemaSnapshot | null> {
  const base = filename.replace(/\.sql$/, "");
  const file = `${base}.snapshot.json`;
  try {
    const content = await readFile(resolve(metaDir, file), "utf-8");
    return parseSnapshotFile(content, file).snapshot;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    throw err;
  }
}

async function safeListTables(adapter: CLIDatabaseAdapter): Promise<string[]> {
  try {
    return await (
      adapter as unknown as { listTables: () => Promise<string[]> }
    ).listTables();
  } catch {
    return [];
  }
}

export async function runMigrateResolve(
  options: ResolvedOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const { mode, filename } = pickMode(options);

  logger.header("Migrate Resolve");

  const dbValidation = validateDatabaseEnv();
  if (!dbValidation.valid || !dbValidation.dialect) {
    for (const err of dbValidation.errors ?? []) logger.error(err);
    process.exit(1);
  }
  const dialect = dbValidation.dialect;

  const configResult = await loadConfig({
    configPath: options.config,
    cwd: options.cwd,
    debug: options.verbose,
  });
  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);
  const metaDir = resolve(migrationsDir, "meta");

  const adapter: CLIDatabaseAdapter = await createAdapter({
    dialect: dbValidation.dialect,
    databaseUrl: dbValidation.databaseUrl,
    logger: options.verbose ? logger : undefined,
  });

  try {
    const db = (adapter as unknown as DrizzleAdapter).getDrizzle();
    const repo = new SchemaEventsRepository(db, dialect);

    // fail-fast mode (the default) never returns undefined — it runs fn or
    // throws — so the non-null assertion below is safe.
    const result = (await withMigrateLock(db, dialect, () =>
      resolveMigration({
        mode,
        filename,
        skipVerify: options.skipVerify,
        repo,
        fileExists: name => fileExistsIn(migrationsDir, name),
        loadTargetSnapshot: () => loadSnapshot(metaDir, filename),
        introspectLive: async () => {
          const live = await safeListTables(adapter);
          const managed = live.filter(t =>
            CORE_TABLE_PREFIXES.some(p => t.startsWith(p))
          );
          return introspectLiveSnapshot(db, dialect, managed);
        },
      })
    ))!;

    switch (result.kind) {
      case "applied":
        logger.success(
          `Marked ${filename} as applied${result.supersededFailedId ? " (superseded prior failed event)" : ""}.`
        );
        break;
      case "rolled-back":
        logger.success(
          `Recorded rolled_back for ${filename}; it will re-run on next migrate.`
        );
        break;
      case "failed-cleanup":
        logger.success(`Cleaned up failed event for ${filename}.`);
        break;
      case "noop":
        logger.info(result.reason);
        break;
    }
  } finally {
    await adapter.disconnect();
  }
}

export function registerMigrateResolveCommand(program: Command): void {
  program
    .command("migrate:resolve")
    .description(
      "Recover migration bookkeeping: mark a file applied/rolled-back, or clean up a failed attempt"
    )
    .option(
      "--applied <filename>",
      "Mark <filename> as applied (verifies live == target snapshot unless --skip-verify)"
    )
    .option(
      "--rolled-back <filename>",
      "Record a rolled_back event so <filename> re-runs on next migrate"
    )
    .option(
      "--failed-cleanup <filename>",
      "Flip a stuck failed event for <filename> to rolled_back (edit the .sql before retrying)"
    )
    .option(
      "--skip-verify",
      "With --applied, skip the live-vs-snapshot equivalence check",
      false
    )
    .action(async (cmdOptions: ResolveCommandOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);
      const resolvedOptions: ResolvedOptions = {
        ...cmdOptions,
        config: globalOpts.config,
        verbose: globalOpts.verbose,
        quiet: globalOpts.quiet,
        cwd: globalOpts.cwd,
      };
      try {
        await runMigrateResolve(resolvedOptions, context);
      } catch (error) {
        context.logger.error(
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
