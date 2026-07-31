// Production-only run-on-boot migrations (opt-in via db.runMigrationsOnBoot).
//
// The development sibling is `runBootTimeApplyIfDev` (boot-apply.ts), which
// pushes code-first schema deltas in dev. This one applies COMMITTED migration
// files in PRODUCTION, under the wait-mode lock, so N instances booting at once
// don't race — one applies while the others wait, then all boot with the schema
// ready. Failure-safe: it logs loudly but never throws past the boot (a thrown
// migrateCore is caught here), so a bad migration doesn't take down the app.

import { resolve } from "node:path";

import { FIELD_GROUP_MIGRATION_PHASE } from "../domains/field-groups/migration/run";

interface AdapterLike {
  dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle: () => unknown;
  tableExists: (name: string) => Promise<boolean>;
  executeQuery: (sql: string) => Promise<unknown>;
}

interface LoggerLike {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
}

interface MigrateCoreLike {
  (deps: {
    dialect: AdapterLike["dialect"];
    db: unknown;
    adapter: AdapterLike;
    migrationsDir: string;
    logger: LoggerLike;
    lockMode: "wait";
    ttlSeconds?: number;
    isSettled?: () => Promise<boolean>;
    ensureLedger?: () => Promise<void>;
  }): Promise<{ applied: number; coreChanged: boolean }>;
}

export interface RunProdMigrationsArgs {
  config: {
    db: {
      runMigrationsOnBoot?: boolean;
      migrationsDir: string;
      migrateLockTtlSeconds?: number;
    };
  };
  adapter: AdapterLike;
  logger: LoggerLike;
  /** Injected for tests; defaults to the real migrateCore + ledger bootstrap. */
  migrateCore?: MigrateCoreLike;
}

export async function runProdMigrationsIfEnabled(
  args: RunProdMigrationsArgs
): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  if (args.config.db.runMigrationsOnBoot !== true) return;

  const { adapter, logger } = args;
  const migrationsDir = resolve(process.cwd(), args.config.db.migrationsDir);

  // migrateCore -> runFileMigrations expects the full CLI `Logger` surface
  // (notably `.success`, plus cosmetic helpers). The boot callers
  // (init.ts/auth-handler.ts) only provide info/warn/error/debug, so adapt the
  // minimal boot logger to a complete Logger here. Without this, the first
  // applied migration throws "logger.success is not a function" mid-run, which
  // is caught below as a (false) failure and aborts any remaining migrations.
  const noop = (): void => {};
  const coreLogger = {
    debug: logger.debug ?? noop,
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
    success: (m: string) => logger.info(m),
    newline: noop,
    divider: noop,
    header: (m: string) => logger.info(m),
    item: (m: string) => logger.info(m),
    keyValue: (k: string, v: string | number | boolean) =>
      logger.info(`${k}: ${String(v)}`),
    table: noop,
    spinner: (_m: string) => ({ stop: noop }),
    setOptions: noop,
    getOptions: () => ({}),
  };

  const ensureLedger = async (): Promise<void> => {
    if (!(await adapter.tableExists("nextly_schema_events"))) {
      const { getSchemaEventsDdl } = await import(
        "../domains/schema/events/schema-events-ddl"
      );
      for (const stmt of getSchemaEventsDdl(adapter.dialect)) {
        await adapter.executeQuery(stmt);
      }
    }
  };

  const core: MigrateCoreLike =
    args.migrateCore ??
    (async deps => {
      const { migrateCore } = await import("../cli/commands/migrate");
      // migrateCore's typed deps require a CLIDatabaseAdapter + Logger; the
      // boot adapter/logger are structurally compatible for the paths used.
      return migrateCore(deps as never);
    });

  try {
    logger.info("[Nextly] Running production migrations on boot...");
    const { applied } = await core({
      dialect: adapter.dialect,
      db: adapter.getDrizzle(),
      adapter,
      migrationsDir,
      logger: coreLogger,
      lockMode: "wait",
      ttlSeconds: args.config.db.migrateLockTtlSeconds,
      ensureLedger,
    });
    logger.info(`[Nextly] Boot migrations complete (${applied} applied).`);
  } catch (err) {
    // A failed FILE migration is survivable: each file applies in its own
    // transaction, so the database is left at a clean boundary and the app can
    // serve while an operator investigates. That is why this path swallows.
    //
    // A failed STORAGE migration is not. MySQL commits DDL as it is issued and
    // the ledger rewrites commit per batch, so a failure there can leave tables
    // half-renamed and rows half-rewritten. Serving against that state is worse
    // than not booting: the read path treats a missing data table as empty
    // content rather than as an error, so the failure would surface as silently
    // absent content rather than as a stopped deploy.
    if (isStorageMigrationFailure(err)) {
      logger.error(
        `[Nextly] Boot migrations failed while migrating field group storage: ${
          err instanceof Error ? err.message : String(err)
        }. Refusing to start: the database may be partially migrated. Run \`nextly migrate\` to finish or roll it back.`
      );
      throw err;
    }
    logger.error(
      `[Nextly] Boot migrations failed: ${
        err instanceof Error ? err.message : String(err)
      }. The app will continue; run \`nextly migrate\` to resolve.`
    );
  }
}

/**
 * Whether a boot-migration failure came from the storage-format phase.
 *
 * Matched on the marker the phase stamps into every refusal it raises rather
 * than on message text, so a reworded message cannot quietly turn a fatal
 * failure back into a survivable one.
 */
function isStorageMigrationFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const context = (error as { logContext?: unknown }).logContext;
  if (typeof context !== "object" || context === null) return false;
  return (context as { phase?: unknown }).phase === FIELD_GROUP_MIGRATION_PHASE;
}
