/**
 * `nextly migrate:baseline` — adopt an existing database into migrations.
 *
 * A project built with `db:sync` has no migration snapshot, so the first
 * `migrate:create` diffs the config against an EMPTY baseline and emits
 * `CREATE TABLE` for every table that already exists. That file can be applied
 * while the config still matches the database, but the moment the project also
 * has a pending config change the single generated migration bundles "adopt the
 * existing tables" with "apply the change" — and the live database matches
 * neither the empty baseline nor that combined target, so `migrate` reports
 * drift and refuses. No recovery command helps from there.
 *
 * This records the live schema as the STARTING snapshot, with no config change
 * folded into it. Everything downstream then works unchanged: the next
 * `migrate:create` emits a minimal delta against this snapshot.
 *
 * The baseline's target snapshot IS the live schema, so the equivalence check
 * `migrate:resolve --applied` runs passes by construction — this reuses that
 * verification rather than introducing a second, weaker trust path.
 *
 * Unlike `migrate:create`, this command CONNECTS to the database; reading the
 * live schema is the entire point. That is why it is a separate command:
 * `migrate:create` documents "does NOT connect to a database" as an invariant
 * that keeps it usable offline and in CI. The same split is what Flyway
 * (`baseline`), Django (`--fake-initial`), Alembic (`stamp head`) and Prisma
 * (`migrate diff --from-database` + `migrate resolve --applied`) all chose.
 *
 * **Runtime restriction (F11):** CLI-only; never import from runtime code.
 *
 * @module cli/commands/migrate-baseline
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { createBaseline } from "../../domains/schema/migrate/baseline";
import { resolveMigration } from "../../domains/schema/migrate/resolve";
import { formatTimestamp } from "../../domains/schema/migrate-create/format-file";
import {
  loadLatestSnapshot,
  writeSnapshot,
} from "../../domains/schema/migrate-create/snapshot-io";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { isSnapshotComparableTable } from "../../domains/schema/pipeline/managed-tables";
import { createContext, type CommandContext } from "../program";
import {
  createAdapter,
  validateDatabaseEnv,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

import { maybeForceUnlock } from "./migrate";

interface BaselineCommandOptions {
  config?: string;
  cwd?: string;
  verbose?: boolean;
  /** Clear a stale migrate lock before taking it (operator escape hatch). */
  forceUnlock?: boolean;
}

async function listManagedTables(
  adapter: CLIDatabaseAdapter
): Promise<string[]> {
  let live: string[] = [];
  try {
    live = await (
      adapter as unknown as { listTables: () => Promise<string[]> }
    ).listTables();
  } catch {
    return [];
  }
  // Managed main tables only, filtered exactly as `migrate:resolve` filters
  // them. A localized companion is migration-owned and never appears in a
  // `migrate:create` snapshot, so including one here would produce a baseline
  // that no later snapshot could match.
  return live.filter(isSnapshotComparableTable);
}

export async function runMigrateBaseline(
  options: BaselineCommandOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  logger.header("Migrate Baseline");

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
    dialect,
    databaseUrl: dbValidation.databaseUrl,
    logger: options.verbose ? logger : undefined,
  });

  try {
    const db = (adapter as unknown as DrizzleAdapter).getDrizzle();
    await maybeForceUnlock(options, db, dialect);
    const repo = new SchemaEventsRepository(db, dialect);

    const result = await createBaseline({
      existingSnapshot: () => loadLatestSnapshot(metaDir),
      listManagedTables: () => listManagedTables(adapter),
      introspect: tables => introspectLiveSnapshot(db, dialect, tables),
      writeFiles: async ({ baseName, sqlContent, snapshot }) => {
        const sqlPath = resolve(migrationsDir, `${baseName}.sql`);
        await mkdir(migrationsDir, { recursive: true });
        await writeFile(sqlPath, sqlContent, "utf-8");
        // Paired snapshot written through the same helper `migrate:create`
        // uses, so the hash and table ordering match what every other command
        // expects to find.
        const snapshotPath = await writeSnapshot(
          metaDir,
          baseName,
          snapshot,
          sqlContent
        );
        return { sqlPath, snapshotPath };
      },
      recordApplied: ({ filename, snapshot, tables }) =>
        withMigrateLock(db, dialect, () =>
          resolveMigration({
            mode: "applied",
            filename,
            repo,
            fileExists: () => Promise.resolve(true),
            loadTargetSnapshot: () => Promise.resolve(snapshot),
            introspectLive: () => introspectLiveSnapshot(db, dialect, tables),
          })
        ).then(r => r ?? { kind: "noop" }),
      now: new Date(),
      formatTimestamp,
    });

    if (result.kind === "already-managed") {
      logger.error(
        `This project already has a migration snapshot (${result.filename}).`
      );
      logger.newline();
      logger.info(
        "Baselining is for adopting a database that migrations do not manage yet. " +
          "Run `nextly migrate:status` to see where this project stands."
      );
      process.exit(1);
    }

    if (result.kind === "empty-database") {
      logger.error("No managed tables found in the database.");
      logger.newline();
      logger.info(
        "Baselining adopts an EXISTING schema. On an empty database, run " +
          "`nextly migrate:create <name>` and `nextly migrate` instead."
      );
      process.exit(1);
    }

    logger.newline();
    logger.success(`Created baseline → ${result.sqlPath}`);
    logger.success(`Snapshot → ${result.snapshotPath}`);
    logger.keyValue("Tables adopted", result.tableCount);
    if (result.note) logger.info(result.note);
    logger.newline();
    logger.divider();
    logger.success("Database adopted into migrations.");
    logger.newline();
    logger.info("Next steps:");
    logger.item("Commit the baseline .sql and its meta/ snapshot to git", 1);
    logger.item(
      "Run `nextly migrate:create <name>` for your next schema change",
      1
    );
    logger.item("It will now emit only the delta, not the whole schema", 1);
  } finally {
    await adapter.disconnect();
  }
}

export function registerMigrateBaselineCommand(program: Command): void {
  program
    .command("migrate:baseline")
    .description(
      "Adopt an existing (db:sync-managed) database into migrations by recording its schema as the starting snapshot"
    )
    .option("-c, --config <path>", "Path to nextly.config.ts")
    .option("--cwd <path>", "Working directory")
    .option("-v, --verbose", "Verbose output", false)
    .option(
      "--force-unlock",
      "Clear a stale migrate lock before taking it",
      false
    )
    .action(async (cmdOptions: BaselineCommandOptions, cmd: Command) => {
      // Merged with the program's globals, as every sibling migrate command
      // does: `nextly --cwd /app migrate:baseline` puts `--cwd` on the PROGRAM,
      // not the subcommand, so reading command-local options alone would load
      // the config from — and write migrations into — the shell's directory
      // instead of the project the operator named.
      const globalOpts = cmd.optsWithGlobals();
      await runMigrateBaseline(
        { ...globalOpts, ...cmdOptions },
        createContext(globalOpts)
      );
    });
}
