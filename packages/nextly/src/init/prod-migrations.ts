// Production-only run-on-boot migrations (opt-in via db.runMigrationsOnBoot).
//
// The development sibling is `runBootTimeApplyIfDev` (boot-apply.ts), which
// pushes code-first schema deltas in dev. This one is `nextly migrate` run by a
// production start: it applies COMMITTED migration files, under the wait-mode
// lock, so N instances booting at once don't race — one applies while the
// others wait, then all boot with the schema ready. It runs first in the start,
// before anything of the registry is read, so an empty database is set up here
// as the command sets it up, and the rest of the start reads what it wrote.
// Failure-safe: a failed migration is logged and the app serves; an older
// build's stop warns and the app serves. Only a run that cannot account for
// the schema (a held lock, a busy table) refuses the start.

import { resolve } from "node:path";

import {
  busyTableBounds,
  type BusyTableBounds,
} from "../domains/schema/busy-table/bounds";
import type { MigrateCoreDeps } from "../cli/commands/migrate";
import type { RecordedEntities } from "../domains/i18n/migration/recorded-before";
import type { ExtensionSchema } from "../domains/schema/extension/build-extension-schema";
import {
  pluginMigrationArgs,
  type PluginMigrationSet,
} from "../domains/schema/migrate/plugin/run-plugin-migrations";
import { resolveDeclaredSchema } from "../domains/schema/migrate/resolved-schema";
import { NextlyError } from "../errors";
import type { PluginDefinition } from "../plugins/plugin-context";

import {
  allowBootMigrations,
  assertBootMigrationsNotRefused,
  openBootMigrationsGate,
  refuseBootMigrations,
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
    /** See `MigrateCoreDeps.extensionSchema`. */
    extensionSchema: ExtensionSchema | undefined;
    dialect: AdapterLike["dialect"];
    db: unknown;
    adapter: AdapterLike;
    migrationsDir: string;
    logger: LoggerLike;
    lockMode: "wait";
    ttlSeconds?: number;
    lockWaitMs?: number;
    lockCommand?: string;
    lockReleaseOnInterrupt?: boolean;
    isSettled?: () => Promise<boolean>;
    ensureLedger?: () => Promise<void>;
    knownJunctions?: ReadonlySet<string>;
    /** See `MigrateCoreDeps.refuseUnrecognisedBuilderFiles`. */
    refuseUnrecognisedBuilderFiles?: boolean;
    /** See `MigrateCoreDeps.declared`. */
    declared?: {
      junctions?: ReadonlyMap<string, ReadonlySet<string>>;
      tables?: ReadonlySet<string>;
    };
    pluginMigrationSets?: readonly PluginMigrationSet[];
    /**
     * Declared here so the value `pluginMigrationArgs` spreads in is checked
     * against a type. A spread is exempt from excess-property checks, so
     * leaving it off typechecked cleanly while the parameter the real
     * `migrateCore` reads was invisible at this boundary.
     */
    pluginsWithMigrations?: ReadonlySet<string>;
    /** Spread in by `pluginMigrationArgs`, checked here for the same reason. */
    declaredPlugins?: ReadonlySet<string>;
    /** See `MigrateCoreDeps.seedPermissions`. */
    seedPermissions?: () => Promise<void>;
    /** Spread in by `deployStepDeps`, checked here for the reason above. */
    firstRun?: MigrateCoreDeps["firstRun"];
    /** Spread in by `deployStepDeps`, checked here for the reason above. */
    markOrphanedPermissions?: MigrateCoreDeps["markOrphanedPermissions"];
    /** Spread in by `deployStepDeps`, checked here for the reason above. */
    beforeMetadata?: MigrateCoreDeps["beforeMetadata"];
    /** See `MigrateCoreDeps.busyTable`. */
    busyTable?: { bounds: BusyTableBounds; notify: (line: string) => void };
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
    /**
     * Plugin definitions from the same config the CLI reads: boot applies the
     * same plugin migration modules the CLI would, from the same source.
     */
    plugins?: readonly PluginDefinition[];
  };
  /**
   * The whole configuration this start serves, which the container's `config`
   * service holds once registered. Handed in because the step runs first in
   * the start, before that service exists: the access, the translation tables
   * and the user fields are written for it, as `nextly migrate` writes them for
   * the configuration it loads.
   */
  served: object;
  /** Plugin additions to Builder entities, when the caller has them. */
  deferredExtends?: readonly unknown[];
  /**
   * How long the boot waits for a held schema lock, in milliseconds. Absent, it waits as a
   * command-line run does, about a minute; a test shortens it.
   */
  lockWaitMs?: number;
  adapter: AdapterLike;
  logger: LoggerLike;
  /** Injected for tests; defaults to the real migrateCore + ledger bootstrap. */
  migrateCore?: MigrateCoreLike;
  /**
   * Injected for tests; defaults to what `nextly migrate` does once its
   * migrations have applied (`afterStartMigrations`): the translation tables,
   * then the user fields' storage.
   */
  afterMigrations?: (recordedBefore: RecordedEntities | undefined) => Promise<void>;
}

/**
 * The refusal, built in one place so its code and wording cannot drift.
 *
 * `held` is the lock's own refusal when there is one: it names what holds the schema lock, since
 * when, and when the lock lapses if that holder has gone, which is what an operator reading a
 * failed start needs in order to tell a long migration on another instance from a stuck one.
 */
function bootMigrationsNotRun(held?: NextlyError): NextlyError {
  const detail =
    held === undefined ? "" : ` The lock's holder: ${held.publicMessage}`;
  return new NextlyError({
    code: "NEXTLY_BOOT_MIGRATIONS_NOT_RUN",
    publicMessage:
      "Boot migrations did not run: the schema lock was still held after " +
      "waiting. Refusing to start rather than serve against a schema that may " +
      "not match this build. This usually resolves on restart once the other " +
      "run finishes; a holder that has stopped lets the lock lapse on its own, " +
      "and `nextly migrate --force-unlock` clears it at once when no other run " +
      "is in progress." +
      detail,
    cause: held,
  });
}

/** Whether this boot migrates: only in production, and only when opted in. */
function bootMigrationsEnabled(args: RunProdMigrationsArgs): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    args.config.db.runMigrationsOnBoot === true
  );
}

/**
 * The boot logger, widened to the full CLI `Logger` surface.
 *
 * migrateCore -> runFileMigrations expects the full CLI `Logger` surface
 * (notably `.success`, plus cosmetic helpers). The boot caller
 * (`registerServices`) provides only info/warn/error/debug, so adapt the
 * minimal boot logger to a complete Logger here. Without this, the first
 * applied migration throws "logger.success is not a function" mid-run, which
 * is caught below as a (false) failure and aborts any remaining migrations.
 */
function bootCoreLogger(logger: LoggerLike) {
  const noop = (): void => {};
  return {
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
}

/** Create `nextly_schema_events` when the database does not have it yet. */
function schemaLedgerEnsurer(adapter: AdapterLike): () => Promise<void> {
  return async (): Promise<void> => {
    const { ensureSchemaEventsTable } = await import(
      "../domains/schema/events/schema-events-ddl"
    );
    await ensureSchemaEventsTable(adapter);
  };
}

/** The injected `migrateCore`, or the real one, loaded on first use. */
function migrateCoreFor(args: RunProdMigrationsArgs): MigrateCoreLike {
  return (
    args.migrateCore ??
    (async deps => {
      const { migrateCore } = await import("../cli/commands/migrate");
      // migrateCore's typed deps require a CLIDatabaseAdapter + Logger; the
      // boot adapter/logger are structurally compatible for the paths used.
      return migrateCore(deps as never);
    })
  );
}

/**
 * Phase 4 of `nextly migrate`, as the command runs it: the permissions, the
 * declared roles, the preset grants and the Public role with its grants
 * (`seedAccessOnCommandConnection`), for the configuration this start serves.
 * A production start writes none of them itself, so a site that migrates at
 * start gets them here, under the same lock and in the same order as the
 * command: after the registry rows they are read from.
 */
function startAccessSeeder(
  adapter: AdapterLike,
  served: object,
  logger: LoggerLike
): () => Promise<void> {
  return async (): Promise<void> => {
    const { seedAccessOnCommandConnection } = await import(
      "../domains/schema/migrate/command-access"
    );
    // The boot adapter and logger are the command's in all it uses, as for
    // `migrateCore` above.
    await seedAccessOnCommandConnection(
      adapter as never,
      { config: served as never, configPath: null },
      logger as never
    );
  };
}

/**
 * What `nextly migrate` does once its migrations have applied, for the
 * configuration this start serves, in the command's order:
 * - each translated entity's translations table (`ensureLocalizedCompanions`,
 *   supervised, as the command runs it), judged against the registry as it
 *   stood before the migrations;
 * - the user fields' storage (`provisionUserFieldTables`): the code-defined
 *   fields synced into `user_field_definitions`, merged with the admin's, and
 *   a `user_ext` column for each.
 * A production start writes neither itself, so a site that migrates at start
 * gets them here.
 */
async function afterStartMigrations(
  adapter: AdapterLike,
  served: object,
  logger: ReturnType<typeof bootCoreLogger>,
  recordedBefore: RecordedEntities | undefined
): Promise<void> {
  const [{ ensureLocalizedCompanions }, { provisionUserFieldTables }] =
    await Promise.all([
      import("../cli/commands/dev-build"),
      import("../cli/commands/migrate"),
    ]);
  // The boot adapter and logger are the command's in all they use, as for
  // `migrateCore` above.
  await ensureLocalizedCompanions(
    served as never,
    adapter as never,
    { logger } as never,
    "afterApply",
    { supervised: true, recordedBefore }
  );
  await provisionUserFieldTables(
    (served as { users?: never }).users,
    adapter as never,
    logger as never
  );
}

/** What one boot-migration run is handed besides the caller's arguments. */
interface BootMigrationRun {
  core: MigrateCoreLike;
  /** `nextly migrate`'s work once the migrations have applied. */
  afterMigrations: (
    recordedBefore: RecordedEntities | undefined
  ) => Promise<void>;
  coreLogger: ReturnType<typeof bootCoreLogger>;
  migrationsDir: string;
  ensureLedger: () => Promise<void>;
}

/**
 * Apply pending migrations under the wait-mode lock, refuse when the lock was
 * never acquired, and on success do the rest of `nextly migrate`'s work and
 * allow serving.
 */
async function applyBootMigrations(
  args: RunProdMigrationsArgs,
  run: BootMigrationRun
): Promise<void> {
  const { adapter, logger } = args;
  // The busy-table bounds from the environment, checked first: a value outside its range refuses
  // the start before anything is read or changed.
  const bounds = busyTableBounds({ env: process.env });
  logger.info("[Nextly] Running production migrations on boot...");
  // Every entity as the registry records it before any file applies, as the
  // command reads it, so the translation tables after the migrations can tell
  // a field newly translated from one translated before. Nothing on a new
  // database.
  const { readRecordedEntities } = await import(
    "../domains/i18n/migration/recorded-before"
  );
  const recordedBefore = await readRecordedEntities(
    adapter as never,
    args.served as never,
    error =>
      logger.warn(
        `[Nextly] The registry could not be read, so no translations column is judged this run: ${error instanceof Error ? error.message : String(error)}`
      )
  );
  const resolvedSchema = await resolveDeclaredSchema({
    projectRoot: process.cwd(),
    config: args.config,
    deferredExtends: args.deferredExtends,
  });
  // Compiled from this call's config, as every migrate entry point
  // compiles it; see `MigrateCoreDeps.extensionSchema`.
  const [{ compileExtensionSchema }, { deployStepDeps }] = await Promise.all([
    import("../domains/schema/extension/publish"),
    import("../domains/schema/migrate/deploy-step-deps"),
  ]);
  const extensionSchema = await compileExtensionSchema({
    dialect: adapter.dialect,
    plugins: args.config.plugins ?? [],
    config: args.config,
    logger: { warn: m => logger.warn(m) },
  });
  const { applied, ran } = await run.core({
    extensionSchema,
    dialect: adapter.dialect,
    db: adapter.getDrizzle(),
    adapter,
    migrationsDir: run.migrationsDir,
    logger: run.coreLogger,
    // Waits as a command-line run does, and refuses to start below when the lock stays held.
    lockMode: "wait",
    lockCommand: "boot migrations (db.runMigrationsOnBoot)",
    // An app file waits for a busy table in tries, as `nextly migrate` does, each try's notice in
    // the log; a boot whose tries run out refuses to start, as for a held schema lock.
    busyTable: { bounds, notify: line => logger.warn(line) },
    // Inside a server: a SIGTERM may begin a graceful shutdown that lets the work run on, so the
    // lock is left to lapse within one lease rather than released under it.
    lockReleaseOnInterrupt: false,
    ...(args.lockWaitMs !== undefined ? { lockWaitMs: args.lockWaitMs } : {}),
    ttlSeconds: args.config.db.migrateLockTtlSeconds,
    knownJunctions: resolvedSchema.knownJunctions,
    // A file with a Builder name the signature does not recognise is refused
    // here as `nextly migrate` refuses it: this boot runs the same files.
    refuseUnrecognisedBuilderFiles: true,
    // What the declared schema names, which old Builder files are judged
    // against as `nextly migrate` judges them.
    declared: {
      junctions: resolvedSchema.junctionsByEntity,
      tables: resolvedSchema.declaredTables,
    },
    // The same sets the CLI applies, from the same config: a boot that
    // skipped them would serve against a schema missing every plugin
    // table while reporting a clean migrate.
    ...(await pluginMigrationArgs(args.config.plugins ?? [])),
    ensureLedger: run.ensureLedger,
    // The access `nextly migrate` adds once the registry rows are written:
    // a production start adds none, so these migrations are the deploy step.
    seedPermissions: startAccessSeeder(adapter, args.served, run.coreLogger),
    // The first run's record, the orphan marks an applied migration sets, and
    // the refusal of a translations column that cannot hold a newly translated
    // field, as `nextly migrate` hands them (`deployStepDeps`).
    ...deployStepDeps({
      adapter: adapter as never,
      db: adapter.getDrizzle(),
      dialect: adapter.dialect,
      migrationsDir: run.migrationsDir,
      logger: run.coreLogger as never,
      declared: {
        junctions: resolvedSchema.junctionsByEntity,
        tables: resolvedSchema.declaredTables,
      },
      config: args.served as never,
      recordedBefore,
    }),
  });
  // REFUSES rather than serving. A held lock no longer comes back as
  // `ran: false` (the lock throws `NEXTLY_MIGRATE_LOCK_BUSY`, which the
  // failure path below turns into this same refusal), but a run that did not
  // run is still not one to serve after: this process never learned whether
  // the schema it is about to serve matches the code.
  //
  // `applied` is 0 here and 0 on an up-to-date database, which is why this
  // once logged `complete (0 applied)` and started anyway. On a rolling
  // deploy that is the second replica serving traffic against a schema it
  // never migrated.
  //
  // Failing startup is recoverable and quiet in an orchestrator: the process
  // exits, the platform restarts it, and by then the holder has usually
  // finished; a holder that died lets the lock lapse within one lease.
  if (!ran) {
    throw bootMigrationsNotRun();
  }
  // After the migrations, as `nextly migrate` does: the translation tables
  // and the user fields follow the configuration's final schema.
  await run.afterMigrations(recordedBefore);
  logger.info(`[Nextly] Boot migrations complete (${applied} applied).`);

  // Nothing of the registry is reloaded: the step runs before the start reads
  // any of it, so the start registers what the migrations left, as a start
  // after `nextly migrate` does.
  allowBootMigrations();
}

/**
 * The refusal a failed run amounts to, or undefined when the failure is one
 * the app can serve through.
 *
 * The fatal shapes: the refusal itself; the schema lock's own refusal,
 * `NEXTLY_MIGRATE_LOCK_BUSY`, which it throws on every dialect when the wait
 * ends with the lock still held; a busy table waited out
 * (`NEXTLY_TABLE_BUSY`), and a busy-table bound set out of its range. Each
 * means this process would serve a schema it cannot account for. An older
 * build's `MIGRATION_MISSING` is not among them: see
 * {@link isOlderBuildStop}.
 */
function fatalBootMigrationError(err: unknown): NextlyError | undefined {
  if (!(err instanceof NextlyError)) return undefined;
  if (err.code === "NEXTLY_BOOT_MIGRATIONS_NOT_RUN") return err;
  if (err.code === "NEXTLY_MIGRATE_LOCK_BUSY") {
    return bootMigrationsNotRun(err);
  }
  // A busy table waited out, refused as itself, as for a held schema lock: its message names the
  // table, what holds it and what to do. So is a busy-table bound set out of its range, refused
  // before anything was read or changed.
  if (err.code === "NEXTLY_TABLE_BUSY") return err;
  if (
    err.code === "INVALID_INPUT" &&
    (err.logContext as { reason?: unknown } | undefined)?.reason ===
      "busy-table-bound-invalid"
  ) {
    return err;
  }
  return undefined;
}

/**
 * Whether the run stopped because the database holds applied migrations this
 * build's folder lacks: an older build, such as a rollback or an old preview,
 * against a database a newer build migrated.
 *
 * The stop comes before the run writes anything, so the newer build's state
 * is already as it left it. The start then goes on and serves what the
 * database holds, as a start without migrations at start does (D8); only a
 * warning names the migrations.
 */
function isOlderBuildStop(err: unknown): err is NextlyError {
  return err instanceof NextlyError && err.code === "MIGRATION_MISSING";
}

/**
 * Settle the gate after a failed run: refuse for a fatal failure, otherwise
 * log it and allow serving. Nothing of the registry is reloaded: the start
 * reads it after this step.
 */
function settleFailedBootMigrations(
  err: unknown,
  args: RunProdMigrationsArgs
): void {
  const { logger } = args;
  if (isOlderBuildStop(err)) {
    // Its message names each migration the build lacks.
    logger.warn(
      `[Nextly] ${err.publicMessage} This build is older than the database: ` +
        "the migrations at start wrote nothing, and the app starts on the " +
        "database as the newer build left it."
    );
    allowBootMigrations();
    return;
  }
  // A refusal is not a failure to swallow. Every other error here is
  // recoverable by running `nextly migrate` against a database the app can
  // still usefully serve; this one means the app does not know what it is
  // serving, which is the case the refusal exists for.
  const fatal = fatalBootMigrationError(err);
  if (fatal !== undefined) {
    // Recorded before rethrowing: `registerServices` checks it before it
    // connects anything, so every later boot attempt in this process refuses
    // at once. The throw itself makes `registerServices` release the adapter
    // and container this boot acquired.
    refuseBootMigrations(fatal);
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
  allowBootMigrations();
}

/**
 * Applies a production boot's migrations where the site opted in (`db.runMigrationsOnBoot`), and
 * answers whether they applied: a start that migrated itself then does the deploy step's other
 * work too, as `nextly migrate` would have.
 */
export async function runProdMigrationsIfEnabled(
  args: RunProdMigrationsArgs
): Promise<boolean> {
  // Before the environment checks, because a process that has already refused
  // must keep refusing regardless of how the next caller reaches this.
  //
  // The REFUSAL only, not the pending gate: this function is what settles that
  // gate, so awaiting it here would deadlock the very boot it was called to
  // perform.
  assertBootMigrationsNotRefused();

  // Nothing to run: the gate is never opened for this boot. Settled anyway,
  // so a gate some earlier code path left pending cannot outlive a boot that
  // decided not to migrate.
  if (!bootMigrationsEnabled(args)) {
    allowBootMigrations();
    return false;
  }

  // Opened here, once the decision to run is made, because every path below
  // settles it: the success path and the tolerated failure allow serving, the
  // refusal refuses. The function that settles the gate is the only one that
  // opens it, so the decision to run is read in one place.
  openBootMigrationsGate();

  const coreLogger = bootCoreLogger(args.logger);
  const run: BootMigrationRun = {
    migrationsDir: resolve(process.cwd(), args.config.db.migrationsDir),
    coreLogger,
    ensureLedger: schemaLedgerEnsurer(args.adapter),
    core: migrateCoreFor(args),
    afterMigrations:
      args.afterMigrations ??
      (recordedBefore =>
        afterStartMigrations(
          args.adapter,
          args.served,
          coreLogger,
          recordedBefore
        )),
  };

  try {
    await applyBootMigrations(args, run);
    return true;
  } catch (err) {
    settleFailedBootMigrations(err, args);
    return false;
  }
}
