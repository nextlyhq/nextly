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
import { resolveDeclaredSchema } from "../../domains/schema/migrate/resolved-schema";
import { parseSnapshotFile } from "../../domains/schema/migrate-create/snapshot-io";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../../domains/schema/pipeline/diff/types";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { snapshotComparableTables } from "../../domains/schema/pipeline/managed-tables";
import { describeError, NextlyError } from "../../errors/index";
import { createContext, type CommandContext } from "../program";
import {
  createAdapter,
  validateDatabaseEnv,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

import { maybeForceUnlock } from "./migrate";

interface ResolveCommandOptions {
  applied?: string;
  rolledBack?: string;
  failedCleanup?: string;
  skipVerify?: boolean;
  /** Clear a stale migrate lock before taking it (operator escape hatch). */
  forceUnlock?: boolean;
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

    // Clear a stale lock first when --force-unlock is passed (e.g. left by a
    // crashed prior run): the lock-busy error tells operators to re-run with
    // this flag, and recovery is exactly when a stale lock is most likely.
    await maybeForceUnlock(options, db, dialect);

    const outcome = await withMigrateLock(db, dialect, () =>
      resolveMigration({
        mode,
        filename,
        skipVerify: options.skipVerify,
        repo,
        fileExists: name => fileExistsIn(migrationsDir, name),
        loadTargetSnapshot: () => loadSnapshot(metaDir, filename),
        introspectLive: async () => {
          // Config and the Builder manifest, merged as generation merges them,
          // so the verifier excludes the same derived tables the snapshot never
          // held. Resolved HERE rather than before the lock because this
          // callback is its only consumer and a malformed `ui-schema.json`
          // throws: loading it eagerly would take --rolled-back,
          // --failed-cleanup and --skip-verify down with it, and those are the
          // modes an operator reaches for when something is already broken.
          const resolvedSchema = await resolveDeclaredSchema({
            projectRoot: cwd,
            config: configResult.config,
            deferredExtends: configResult.deferredExtends,
          });
          const live = await safeListTables(adapter);
          // Managed main tables only. A localized companion is
          // migration-owned and never appears in a `migrate:create` snapshot,
          // so including one here can never match the file this is compared
          // against and the equivalence check refuses the command.
          // Junctions are excluded for exactly the reason the comment above
          // gives for companions: neither is declared by config, so neither
          // appears in the snapshot this is compared against, and a live
          // snapshot carrying one can never match it. The target's own tables
          // are the declaration, so a collection whose name resembles the
          // generated junction shape is not mistaken for one.
          // The same snapshot `loadTargetSnapshot` returns, read again rather
          // than threaded: it is a file read, and the two callbacks are
          // independent by design so the verifier can be driven without one.
          // A missing snapshot is the verifier's own error to report; here it
          // just means no declaration is available, and the name pattern alone
          // decides.
          const target = await loadSnapshot(metaDir, filename);
          const managed = snapshotComparableTables(
            live,
            new Set((target?.tables ?? []).map(t => t.name)),
            // A custom `options.junctionTable` name matches no convention and
            // is in no snapshot, so without it the verifier compares a live
            // scope containing the junction against a target that never could
            // and refuses a recovery the operator has no other way to make.
            resolvedSchema.knownJunctions
          );
          return introspectLiveSnapshot(db, dialect, managed);
        },
      })
    );

    // Fail-fast mode: a busy lock throws rather than reporting `ran: false`, so
    // this branch is unreachable today. Asserted rather than assumed, because
    // "unreachable" is a property of the caller's options and those move.
    if (!outcome.ran) {
      throw new NextlyError({
        code: "NEXTLY_RESOLVE_LOCK_NOT_HELD",
        publicMessage:
          "The migrate lock was released without resolving the migration. " +
          "Nothing was written; retry once no other schema operation is running.",
      });
    }
    const result = outcome.value;

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
    // This command takes the shared migrate lock, and the lock-busy error
    // tells operators to re-run with this flag — so every lock-taking
    // command must register it. Same escape hatch as `nextly migrate`.
    .option(
      "--force-unlock",
      "Clear a stale migrate lock before running",
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
        context.logger.error(describeError(error));
        process.exit(1);
      }
    });
}
