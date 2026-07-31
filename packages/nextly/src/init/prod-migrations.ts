// Production-only run-on-boot migrations (opt-in via db.runMigrationsOnBoot).
//
// The development sibling is `runBootTimeApplyIfDev` (boot-apply.ts), which
// pushes code-first schema deltas in dev. This one applies COMMITTED migration
// files in PRODUCTION, under the wait-mode lock, so N instances booting at once
// don't race — one applies while the others wait, then all boot with the schema
// ready. Failure-safe: it logs loudly but never throws past the boot (a thrown
// migrateCore is caught here), so a bad migration doesn't take down the app.

import { resolve } from "node:path";

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
    logger.error(
      `[Nextly] Boot migrations failed: ${
        err instanceof Error ? err.message : String(err)
      }. The app will continue; run \`nextly migrate\` to resolve.`
    );
  }
}
