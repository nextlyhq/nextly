/**
 * `nextly upgrade` — one-shot bookkeeping consolidation (spec §4.10).
 *
 * Backfills legacy `nextly_migrations` + `nextly_migration_journal` rows into
 * the new `nextly_schema_events` table and drops the legacy tables. The
 * orchestration (`runUpgrade`) is a plain async function taking an
 * adapter-like dependency so it is testable without the CLI shell.
 *
 * @module cli/commands/upgrade
 * @since v0.0.3-alpha (Plan B)
 */

import { createInterface } from "node:readline";

import type { Command } from "commander";
import { sql } from "drizzle-orm";

import {
  mapJournalRow,
  mapMigrationsRow,
  synthesizedCoreApplyEvent,
  type BackfillEvent,
} from "../../domains/schema/events/backfill";
import {
  assertNoLegacyBookkeeping,
  detectLegacyBookkeeping,
} from "../../domains/schema/events/legacy-detection";
import { getSchemaEventsDdl } from "../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../domains/schema/events/schema-events-repository";
import { reconcileCore } from "../../domains/schema/migrate/core-reconcile";
import { withMigrateLock } from "../../domains/schema/pipeline/locks";
import { NextlyError } from "../../errors";
import { createContext } from "../program";
import { createAdapter, validateDatabaseEnv } from "../utils/adapter";

type Dialect = "postgresql" | "mysql" | "sqlite";

const EVENTS_TABLE = "nextly_schema_events";

/** Minimal adapter slice `runUpgrade` needs. The real DrizzleAdapter satisfies it. */
export interface UpgradeAdapter {
  tableExists: (tableName: string) => Promise<boolean>;
  getDrizzle: () => unknown;
  dropTable: (
    tableName: string,
    options?: { ifExists?: boolean }
  ) => Promise<void>;
  getCapabilities: () => { dialect: Dialect };
}

interface UpgradeLogger {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
}

export interface RunUpgradeDeps {
  adapter: UpgradeAdapter;
  logger?: UpgradeLogger;
  /** When true and no --confirm-backed-up, prompt via `promptConfirm`. */
  isTTY?: boolean;
  /** Interactive backup confirmation (TTY only). Returns true to proceed. */
  promptConfirm?: () => Promise<boolean>;
}

export interface RunUpgradeOptions {
  confirmBackedUp?: boolean;
  force?: boolean;
  /** Advanced: override the events table name on a foreign-table collision. */
  targetTableName?: string;
}

// --- raw exec/query helpers (dialect-branched; only the methods used) -------

function execRaw(
  db: unknown,
  dialect: Dialect,
  statement: string
): Promise<void> {
  if (dialect === "sqlite") {
    (db as { run: (q: unknown) => unknown }).run(sql.raw(statement));
    return Promise.resolve();
  }
  return (db as { execute: (q: unknown) => Promise<unknown> })
    .execute(sql.raw(statement))
    .then(() => undefined);
}

async function queryRaw(
  db: unknown,
  dialect: Dialect,
  statement: string
): Promise<Array<Record<string, unknown>>> {
  if (dialect === "sqlite") {
    return (db as { all: (q: unknown) => Array<Record<string, unknown>> }).all(
      sql.raw(statement)
    );
  }
  const res = await (
    db as { execute: (q: unknown) => Promise<unknown> }
  ).execute(sql.raw(statement));
  // pg returns { rows }, mysql2 returns [rows, fields].
  if (Array.isArray(res)) {
    return (Array.isArray(res[0]) ? res[0] : res) as Array<
      Record<string, unknown>
    >;
  }
  return (res as { rows?: Array<Record<string, unknown>> }).rows ?? [];
}

/** True iff the existing events table has the expected key columns. */
async function hasExpectedShape(
  db: unknown,
  dialect: Dialect,
  table: string
): Promise<boolean> {
  try {
    await queryRaw(
      db,
      dialect,
      `SELECT event_type, status, source FROM ${table} LIMIT 0`
    );
    return true;
  } catch {
    return false;
  }
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") {
    return new Date(value);
  }
  return null;
}

/** Drop undefined keys so the repository inserts NULL/defaults cleanly. */
function toInsertValues(event: BackfillEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

async function confirmBackup(
  options: RunUpgradeOptions,
  deps: RunUpgradeDeps
): Promise<void> {
  if (options.force || options.confirmBackedUp) return;
  if (deps.isTTY && deps.promptConfirm) {
    const ok = await deps.promptConfirm();
    if (ok) return;
    throw new NextlyError({
      code: "NEXTLY_UPGRADE_IN_PROGRESS",
      publicMessage: "Upgrade cancelled by operator.",
    });
  }
  throw new NextlyError({
    code: "NEXTLY_UPGRADE_IN_PROGRESS",
    publicMessage:
      "Refusing to upgrade without a confirmed backup. Re-run with " +
      "`--confirm-backed-up` (CI/non-TTY) after backing up your database.",
  });
}

/**
 * Run the one-shot upgrade. Idempotent: a second run on an already-upgraded DB
 * is a no-op. See spec §4.10 for the full flow.
 */
export async function runUpgrade(
  options: RunUpgradeOptions,
  deps: RunUpgradeDeps
): Promise<void> {
  const { adapter } = deps;
  const dialect = adapter.getCapabilities().dialect;
  const db = adapter.getDrizzle();
  const log = (msg: string) => deps.logger?.info?.(msg);
  const eventsTable = options.targetTableName ?? EVENTS_TABLE;

  await withMigrateLock(db, dialect, async () => {
    // 3. Introspect.
    const legacy = await detectLegacyBookkeeping(adapter);
    const eventsExists = await adapter.tableExists(eventsTable);
    const eventsShapeOk = eventsExists
      ? await hasExpectedShape(db, dialect, eventsTable)
      : false;

    // 4. Idempotency (before collision): clean DB with an events table = done.
    if (!legacy.hasLegacy && eventsExists && eventsShapeOk) {
      log("Already upgraded. Nothing to do.");
      return;
    }

    // 5. Collision: a foreign table is squatting the name.
    if (eventsExists && !eventsShapeOk) {
      throw new NextlyError({
        code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
        publicMessage:
          `A table named "${eventsTable}" already exists with an unexpected ` +
          "shape. Rename it, or re-run with `--target-table-name <name>`.",
      });
    }

    // 6. Backup confirmation.
    await confirmBackup(options, deps);

    // 7. Create the events table if absent.
    if (!eventsExists) {
      for (const statement of getSchemaEventsDdl(dialect)) {
        await execRaw(db, dialect, statement);
      }
      log(`Created ${eventsTable}`);
    }

    // 8. Backfill.
    const repo = new SchemaEventsRepository(db, dialect);
    let migratedCount = 0;
    let journaledCount = 0;

    if (legacy.tables.includes("nextly_migrations")) {
      const rows = await queryRaw(
        db,
        dialect,
        "SELECT filename, sha256, status, applied_at, applied_by, duration_ms, error_json FROM nextly_migrations"
      );
      for (const r of rows) {
        const event = mapMigrationsRow({
          filename: String(r.filename),
          sha256: String(r.sha256),
          status: String(r.status),
          appliedAt: toDate(r.applied_at),
          appliedBy: (r.applied_by as string | null) ?? null,
          durationMs: (r.duration_ms as number | null) ?? null,
          errorJson: r.error_json ?? null,
        });
        await repo.insertEvent(toInsertValues(event));
        migratedCount++;
      }
      log(`Backfilled ${migratedCount} rows from nextly_migrations`);
    }

    if (legacy.tables.includes("nextly_migration_journal")) {
      const rows = await queryRaw(
        db,
        dialect,
        "SELECT source, status, started_at, ended_at, duration_ms, scope_kind, scope_slug FROM nextly_migration_journal"
      );
      for (const r of rows) {
        const event = mapJournalRow({
          source: String(r.source),
          status: String(r.status),
          startedAt: toDate(r.started_at),
          endedAt: toDate(r.ended_at),
          durationMs: (r.duration_ms as number | null) ?? null,
          scopeKind: (r.scope_kind as string | null) ?? null,
          scopeSlug: (r.scope_slug as string | null) ?? null,
        });
        if (!event) {
          deps.logger?.warn?.(
            `Skipping non-finalized journal row (status=${String(r.status)}).`
          );
          continue;
        }
        await repo.insertEvent(toInsertValues(event));
        journaledCount++;
      }
      log(`Backfilled ${journaledCount} rows from nextly_migration_journal`);
    }

    // Synthesize a core_apply audit row for the pre-existing core schema.
    await repo.insertEvent(toInsertValues(synthesizedCoreApplyEvent()));
    log("Synthesized 1 audit row for pre-existing core schema");

    // 9. Drop legacy tables.
    for (const table of legacy.tables) {
      await adapter.dropTable(table, { ifExists: true });
      log(`Dropped ${table}`);
    }

    log("Done. You can now run `pnpm run dev` or `pnpm nextly migrate`.");
  });
}

export interface RunReconcileCoreDeps {
  adapter: UpgradeAdapter;
  logger?: UpgradeLogger;
  confirmDestructive: (reasons: string[]) => Promise<boolean>;
}

/** Injected for tests; defaults to the real reconcileCore. */
interface ReconcileCoreInjection {
  reconcileCore?: typeof reconcileCore;
}

/**
 * `nextly upgrade --reconcile-core` (spec §4.10.3). Standalone Phase 1 in
 * dev-loose with per-destructive-op confirmation. Gated by the legacy
 * bookkeeping check and the shared migrate lock. Use only when `nextly
 * migrate` reports core schema drift after upgrading.
 */
export async function runReconcileCore(
  deps: RunReconcileCoreDeps,
  injection: ReconcileCoreInjection = {}
): Promise<void> {
  const reconcile = injection.reconcileCore ?? reconcileCore;
  const { adapter } = deps;
  const dialect = adapter.getCapabilities().dialect;
  const db = adapter.getDrizzle();

  await assertNoLegacyBookkeeping(adapter);

  await withMigrateLock(db, dialect, async () => {
    await reconcile({
      db,
      dialect,
      mode: "dev-loose",
      confirmDestructive: deps.confirmDestructive,
      logger: deps.logger,
    });
  });
  deps.logger?.info?.("Core schema reconciliation complete.");
}

// ---------------------------------------------------------------------------
// CLI command registration
// ---------------------------------------------------------------------------

export interface UpgradeCommandOptions {
  confirmBackedUp?: boolean;
  force?: boolean;
  targetTableName?: string;
  reconcileCore?: boolean;
}

/** Minimal interactive yes/no prompt for the TTY backup confirmation. */
function promptYesNo(question: string): Promise<boolean> {
  return new Promise(resolve => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, answer => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade")
    .description(
      "Consolidate legacy bookkeeping tables into nextly_schema_events"
    )
    .option(
      "--confirm-backed-up",
      "Confirm a backup exists (required in CI/non-TTY)",
      false
    )
    .option("-f, --force", "Skip the interactive backup prompt", false)
    .option(
      "--target-table-name <name>",
      "Override the events table name on a collision"
    )
    .option(
      "--reconcile-core",
      "Reconcile drifted core schema (dev-loose, confirms each destructive op). Use only if `nextly migrate` reports core drift.",
      false
    )
    .action(async (cmdOptions: UpgradeCommandOptions, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals();
      const context = createContext(globalOpts);

      const dbValidation = validateDatabaseEnv();
      if (!dbValidation.valid || !dbValidation.dialect) {
        for (const err of dbValidation.errors ?? []) context.logger.error(err);
        process.exit(1);
      }

      let adapter: { disconnect?: () => Promise<void> } & UpgradeAdapter;
      try {
        adapter = (await createAdapter({
          dialect: dbValidation.dialect,
          databaseUrl: dbValidation.databaseUrl,
          logger: globalOpts.verbose ? context.logger : undefined,
        })) as unknown as { disconnect?: () => Promise<void> } & UpgradeAdapter;
      } catch (error) {
        context.logger.error(
          `Failed to connect to database: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exit(1);
      }

      try {
        if (cmdOptions.reconcileCore) {
          await runReconcileCore({
            adapter,
            logger: {
              info: msg => context.logger.info(msg),
              warn: msg => context.logger.warn(msg),
            },
            confirmDestructive: reasons =>
              promptYesNo(
                `Reconcile core schema with these destructive operations?\n  - ${reasons.join("\n  - ")}\nProceed? [y/N]: `
              ),
          });
        } else {
          await runUpgrade(
            {
              confirmBackedUp: cmdOptions.confirmBackedUp,
              force: cmdOptions.force,
              targetTableName: cmdOptions.targetTableName,
            },
            {
              adapter,
              logger: {
                info: msg => context.logger.info(msg),
                warn: msg => context.logger.warn(msg),
              },
              isTTY: Boolean(process.stdin.isTTY),
              promptConfirm: () =>
                promptYesNo("Have you backed up your database? [y/N]: "),
            }
          );
        }
      } catch (error) {
        context.logger.error(
          error instanceof Error ? error.message : String(error)
        );
        process.exitCode = 1;
      } finally {
        await adapter.disconnect?.();
      }
    });
}
