/**
 * `nextly migrate:baseline` — adopt a database that already exists.
 *
 * The graduation path from `db:sync` to migrations runs through here. A project
 * developed with `db:sync` has real tables and no snapshot, so its first
 * `migrate:create` diffs the config against nothing and emits `CREATE TABLE`
 * for the whole schema — a file that can never be applied, because the live
 * database matches neither the empty baseline it assumes nor the target it
 * describes. This records where the history begins, and the next
 * `migrate:create` emits a delta.
 *
 * **This command connects to the database, and `migrate:create` still does
 * not.** That invariant (`migrate-create.ts`) is what makes generation work
 * offline and in CI, and it survives: generation reads the config, adoption
 * reads the database. They are different questions, so they are different
 * commands rather than a flag on one.
 *
 * The reasoning for writing a real migration file rather than only a marker,
 * and for doing both halves in one command, is in
 * `domains/schema/migrate/baseline.ts`.
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
import { planBaseline } from "../../domains/schema/migrate/baseline";
import {
  formatMigrationFile,
  formatTimestamp,
  slugify,
} from "../../domains/schema/migrate-create/format-file";
import {
  loadLatestSnapshot,
  writeSnapshot,
} from "../../domains/schema/migrate-create/snapshot-io";
import { introspectLiveSnapshot } from "../../domains/schema/pipeline/diff/introspect-live";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { isSnapshotComparableTable } from "../../domains/schema/pipeline/managed-tables";
import { generateSQL } from "../../domains/schema/pipeline/sql-templates/index";
import { describeError } from "../../errors/index";
import { createContext, type CommandContext } from "../program";
import {
  createAdapter,
  validateDatabaseEnv,
  type CLIDatabaseAdapter,
} from "../utils/adapter";
import { loadConfig } from "../utils/config-loader";

import { maybeForceUnlock } from "./migrate";

interface BaselineOptions {
  name?: string;
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
  forceUnlock?: boolean;
}

/** The migration name used when the operator supplies none. */
const DEFAULT_BASELINE_NAME = "baseline";

async function safeListTables(adapter: CLIDatabaseAdapter): Promise<string[]> {
  try {
    return await (
      adapter as unknown as { listTables: () => Promise<string[]> }
    ).listTables();
  } catch {
    return [];
  }
}

export async function runMigrateBaseline(
  options: BaselineOptions,
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
    const repo = new SchemaEventsRepository(db, dialect);

    await maybeForceUnlock(
      { forceUnlock: options.forceUnlock === true },
      db,
      dialect
    );

    // The same lock every other migrate command takes: adopting writes a file
    // AND a journal row, and a concurrent `migrate` deciding what to apply must
    // not see one without the other.
    await withMigrateLock(db, dialect, async () => {
      const latest = await loadLatestSnapshot(metaDir);

      // Only tables the migration history is responsible for. A companion is
      // excluded for the same reason it is excluded from drift: it is derived,
      // and adopting it as a first-class table would make the next diff want to
      // drop it.
      const tableNames = (await safeListTables(adapter)).filter(
        isSnapshotComparableTable
      );
      const live = await introspectLiveSnapshot(db, dialect, tableNames);

      const plan = planBaseline({
        live,
        latestSnapshotName: latest?.filename,
      });

      if (plan.kind === "already-baselined") {
        logger.info(
          `This project already has a migration history (${plan.snapshotName}).`
        );
        logger.info(
          "Baselining again would give it a second starting point. Nothing was written."
        );
        return;
      }

      if (plan.kind === "empty-database") {
        logger.info("No managed tables found, so there is nothing to adopt.");
        logger.info(
          "Create your first migration instead:  pnpm nextly migrate:create --name init"
        );
        return;
      }

      const name = slugify(options.name ?? DEFAULT_BASELINE_NAME);
      const now = new Date();
      const baseName = `${formatTimestamp(now)}_${name}`;

      // The body is what would build this schema from nothing. It is never run
      // against THIS database — it is recorded as applied below — but it is
      // what lets a new environment, CI, or `migrate:fresh` build the same
      // schema from the history alone.
      const sqlStatements = plan.operations.map(op => generateSQL(op, dialect));
      const sqlContent = formatMigrationFile({
        name,
        dialect,
        sqlStatements,
        // No down section: reversing a baseline means dropping the schema it
        // adopted, which is never what an operator undoing a migration wants.
        downSqlStatements: [],
        collections: [],
        singles: [],
        components: [],
        hasUserExt: false,
        now,
      });

      await mkdir(migrationsDir, { recursive: true });
      const sqlPath = resolve(migrationsDir, `${baseName}.sql`);
      await writeFile(sqlPath, sqlContent, "utf-8");
      const snapshotPath = await writeSnapshot(
        metaDir,
        baseName,
        plan.snapshot,
        sqlContent
      );

      // Recorded as applied without executing: the tables it describes are
      // already standing. Doing this in the same command is the point — the
      // file alone would be re-run against a database that already has them.
      const eventId = await repo.recordStart({
        eventType: "file_apply",
        source: "cli-migrate",
        filename: `${baseName}.sql`,
      });
      await repo.markApplied(eventId, {
        statementsExecuted: 0,
        uniqueFilename: `${baseName}.sql`,
      });

      logger.newline();
      logger.success(`Adopted ${plan.snapshot.tables.length} existing tables.`);
      logger.info(`  Migration: ${sqlPath}`);
      logger.info(`  Snapshot:  ${snapshotPath}`);
      logger.newline();
      logger.info(
        "Recorded as applied — it will not run against this database."
      );
      logger.info(
        "Commit both files: they are how another environment builds this schema."
      );
      logger.newline();
      logger.info("Next:  pnpm nextly migrate:create --name <your_change>");
    });
  } finally {
    await adapter.disconnect();
  }
}

export function registerMigrateBaselineCommand(program: Command): void {
  program
    .command("migrate:baseline")
    .description(
      "Adopt an existing database into the migration history (run once, when graduating from db:sync)"
    )
    .option(
      "--name <name>",
      `Migration name (default: "${DEFAULT_BASELINE_NAME}")`
    )
    .option("-c, --config <path>", "Path to nextly.config.ts")
    .option(
      "--force-unlock",
      "Clear a stale migrate lock before taking it (use after a crashed run)"
    )
    .action(async (opts: BaselineOptions, command: Command) => {
      const globalOpts = command.parent?.opts() ?? {};
      const context = createContext(globalOpts);
      try {
        await runMigrateBaseline(
          {
            ...opts,
            verbose: globalOpts.verbose,
            quiet: globalOpts.quiet,
            cwd: globalOpts.cwd,
          },
          context
        );
      } catch (error) {
        context.logger.error(describeError(error));
        process.exit(1);
      }
    });
}
