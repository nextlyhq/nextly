// Production-only run-on-boot migrations (opt-in via db.runMigrationsOnBoot).
//
// The development sibling is `runBootTimeApplyIfDev` (boot-apply.ts), which
// pushes code-first schema deltas in dev. This one applies COMMITTED migration
// files in PRODUCTION, under the wait-mode lock, so N instances booting at once
// don't race — one applies while the others wait, then all boot with the schema
// ready. Failure-safe: it logs loudly but never throws past the boot (a thrown
// migrateCore is caught here), so a bad migration doesn't take down the app.

import { resolve } from "node:path";

import { shutdownServices } from "../di";
import { resolveDeclaredSchema } from "../domains/schema/migrate/resolved-schema";
import { NextlyError } from "../errors";

import {
  awaitBootMigrations,
  beginBootMigrations,
} from "./boot-migrations-gate";

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

/**
 * Set once this process has refused to serve, and never cleared.
 *
 * The refusal has to OUTLIVE the request that raised it. Both production entry
 * points run migrations inside `if (!isServicesRegistered())`, and by the time
 * this throws, `registerServices()` has already marked DI registered — so the
 * next request skips migrations entirely and serves the schema this process was
 * refusing to serve. Throwing once only fails one request.
 *
 * On `globalThis` for the same reason the boot plugin list is: Next.js and
 * Turbopack can evaluate this module in more than one server graph, and a
 * refusal recorded in one copy has to be seen by the other.
 *
 * Never cleared, deliberately. Nothing in the process can establish the schema
 * is now correct — the migration it would need to observe is the one that did
 * not run. A restart is the recovery, and that is what an orchestrator does.
 */

/** The refusal, built in one place so its code and wording cannot drift. */
function bootMigrationsNotRun(dialect: string): NextlyError {
  // Dialect-specific, because the recovery differs and the wrong advice is
  // worse than none. `forceUnlock` deletes the Postgres lock ROW; it returns
  // immediately for every other dialect. MySQL's lock is a session-scoped
  // `GET_LOCK`, so there IS no stale row to clear — it is held by a live
  // connection and dies with it, which makes "restart the holder" the only
  // recovery and `--force-unlock` a no-op that would waste an operator's time
  // during an incident.
  const recovery =
    dialect === "postgresql"
      ? "This usually resolves on restart once the other instance finishes; " +
        "if the lock is stale, clear it with `nextly migrate --force-unlock`."
      : "The lock is held by another live connection and is released when that " +
        "connection ends, so this usually resolves on restart once the other " +
        "instance finishes or is stopped.";

  return new NextlyError({
    code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    publicMessage:
      "Boot migrations did not run: the migrate lock was still held after " +
      "waiting. Refusing to start rather than serve against a schema that may " +
      "not match this build. " +
      recovery,
  });
}

export async function runProdMigrationsIfEnabled(
  args: RunProdMigrationsArgs
): Promise<void> {
  // Before the environment checks, because a process that has already refused
  // must keep refusing regardless of how the next caller reaches this.
  await awaitBootMigrations();

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

  // Opened before any work, so the window this closes — services registered but
  // the schema unverified — never exists unguarded. Consumers that arrive from
  // another surface now wait here instead of serving on the registered flag.
  const gate = beginBootMigrations();

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
      throw bootMigrationsNotRun(adapter.dialect);
    }
    logger.info(`[Nextly] Boot migrations complete (${applied} applied).`);
    gate.allow();
  } catch (err) {
    // A refusal is not a failure to swallow. Every other error here is
    // recoverable by running `nextly migrate` against a database the app can
    // still usefully serve; this one means the app does not know what it is
    // serving, which is the case the refusal exists for.
    // Two fatal shapes, and MySQL is why the second is here: `withMigrateLock`
    // reports a busy lock as `ran: false` on Postgres but THROWS
    // `NEXTLY_MIGRATE_LOCK_BUSY` on MySQL when the wait expires mid-flight.
    // Rethrowing only the first would have left MySQL serving the unmigrated
    // schema this whole change exists to prevent.
    if (
      err instanceof NextlyError &&
      (err.code === "NEXTLY_BOOT_MIGRATIONS_NOT_RUN" ||
        err.code === "NEXTLY_MIGRATE_LOCK_BUSY")
    ) {
      const fatal =
        err.code === "NEXTLY_BOOT_MIGRATIONS_NOT_RUN"
          ? err
          : bootMigrationsNotRun(args.adapter.dialect);
      // Recorded BEFORE rethrowing, so the next request through either entry
      // point refuses too rather than finding services already registered.
      gate.refuse(fatal);
      // Reopen the registration gate, or the sticky flag above is unreachable.
      // Both entry points call this helper only inside
      // `if (!isServicesRegistered())`, and `registerServices()` has already
      // made that false by the time we get here — so a second request would
      // skip this helper entirely, build the dispatcher, and serve. Clearing
      // registration is ONE edit at the point of refusal; adding the check to
      // both caller gates would be the same fix wired into two places, which is
      // how the original defect survived in the first place.
      //
      // It costs a re-registration per request on a process that now fails
      // every request. That is the right trade: the process is refusing to
      // serve and wants restarting, and a wasted registration is cheaper than a
      // request served against a schema nobody verified.
      // `shutdownServices`, not `clearServices`: the latter empties the
      // container WITHOUT disconnecting the adapter, so re-registering on the
      // next request would build a second connected pool and leak one per
      // retry — exhausting connections that healthy replicas need. Tearing
      // down releases what this boot took before reopening the gate.
      await shutdownServices();
      logger.error(`[Nextly] ${fatal.publicMessage}`);
      throw fatal;
    }
    logger.error(
      `[Nextly] Boot migrations failed: ${
        err instanceof Error ? err.message : String(err)
      }. The app will continue; run \`nextly migrate\` to resolve.`
    );
    // The app continues on this path, so the gate must open — a swallowed
    // failure that left it pending would hang every consumer forever, turning a
    // recoverable error into a worse outage than the one being tolerated.
    gate.allow();
  }
}
