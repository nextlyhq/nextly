// Production-only run-on-boot migrations (opt-in via db.runMigrationsOnBoot).
//
// The development sibling is `runBootTimeApplyIfDev` (boot-apply.ts), which
// pushes code-first schema deltas in dev. This one applies COMMITTED migration
// files in PRODUCTION, under the wait-mode lock, so N instances booting at once
// don't race — one applies while the others wait, then all boot with the schema
// ready. Failure-safe: it logs loudly but never throws past the boot (a thrown
// migrateCore is caught here), so a bad migration doesn't take down the app.

import { resolve } from "node:path";

import { resolveDeclaredSchema } from "../domains/schema/migrate/resolved-schema";
import { NextlyError } from "../errors";

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
    knownJunctions?: ReadonlySet<string>;
  }): Promise<{ applied: number; coreChanged: boolean; ran: boolean }>;
}

export interface RunProdMigrationsArgs {
  /**
   * Read only to resolve which tables are DERIVED rather than declared.
   *
   * A many-to-many field may carry `options.junctionTable`, whose name matches
   * no convention and appears in no snapshot, so the drift check has to be told
   * about it or an install that migrates on boot stops with a difference the
   * CLI path would not have reported. The Schema Builder can declare such a
   * field too, which is why the manifest (`db.uiSchemaFile`) is read as well as
   * the config — resolving from the config alone would make boot and CLI
   * disagree about the same database.
   */
  config: {
    db: {
      runMigrationsOnBoot?: boolean;
      migrationsDir: string;
      migrateLockTtlSeconds?: number;
      uiSchemaFile: string;
    };
    collections: readonly unknown[];
    singles?: readonly unknown[];
    fieldGroups?: readonly unknown[];
  };
  /** Plugin additions to Builder entities, when the caller has them. */
  deferredExtends?: readonly unknown[];
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
    const resolvedSchema = await resolveDeclaredSchema({
      projectRoot: process.cwd(),
      config: args.config,
      deferredExtends: args.deferredExtends,
    });
    const { applied, ran } = await core({
      dialect: adapter.dialect,
      db: adapter.getDrizzle(),
      adapter,
      migrationsDir,
      logger: coreLogger,
      lockMode: "wait",
      ttlSeconds: args.config.db.migrateLockTtlSeconds,
      knownJunctions: resolvedSchema.knownJunctions,
      ensureLedger,
    });
    // REFUSES rather than serving. `ran: false` means the migrate lock stayed
    // held past the wait deadline, so this process never learned whether the
    // schema it is about to serve matches the code. The tempting reading — "the
    // holder did the work, carry on" — is an assumption: the holder may have
    // died, been killed, or still be mid-flight, and a lock timing out says
    // nothing about whether migrations ran.
    //
    // `applied` is 0 here and 0 on an up-to-date database, which is why this
    // previously logged `complete (0 applied)` and started anyway. On a rolling
    // deploy that is the second replica serving traffic against a schema it
    // never migrated.
    //
    // Failing startup is recoverable and quiet in an orchestrator: the process
    // exits, the platform restarts it, and by then the holder has usually
    // finished. A genuinely stuck lock needs `nextly migrate --force-unlock`,
    // which is the intervention the situation actually calls for.
    if (!ran) {
      throw new NextlyError({
        code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
        publicMessage:
          "Boot migrations did not run: the migrate lock was still held after " +
          "waiting. Refusing to start rather than serve against a schema that " +
          "may not match this build. This usually resolves on restart once the " +
          "other instance finishes; if the lock is stale, clear it with " +
          "`nextly migrate --force-unlock`.",
      });
    }
    logger.info(`[Nextly] Boot migrations complete (${applied} applied).`);
  } catch (err) {
    // A refusal is not a failure to swallow. Every other error here is
    // recoverable by running `nextly migrate` against a database the app can
    // still usefully serve; this one means the app does not know what it is
    // serving, which is the case the refusal exists for.
    if (
      err instanceof NextlyError &&
      err.code === "NEXTLY_BOOT_MIGRATIONS_NOT_RUN"
    ) {
      logger.error(`[Nextly] ${err.publicMessage}`);
      throw err;
    }
    logger.error(
      `[Nextly] Boot migrations failed: ${
        err instanceof Error ? err.message : String(err)
      }. The app will continue; run \`nextly migrate\` to resolve.`
    );
  }
}
