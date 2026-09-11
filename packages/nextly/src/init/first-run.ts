// First-run static-table push.
//
// F8 PR 6 (review #1+#2): on a brand-new database `next dev` would
// previously fail because static system tables (users, permissions,
// dynamic_collections, etc.) didn't exist. The fix is to create them
// inside `registerServices()` BEFORE the dynamic-table probing runs,
// so that loadDynamicTables + the auto-sync block both see a populated
// schema instead of swallowing "table not exist" errors.
//
// Probe choice: `nextly_schema_events` (Plan B; replaced the legacy
// `nextly_migration_journal` probe in Plan C1).
//   - Namespaced with the `nextly_` prefix — only Nextly creates it.
//   - Part of the core schema (getCoreSchema), so it exists after any
//     successful boot-apply / migrate / upgrade.
//   - Avoids false negatives on shared databases where a non-Nextly
//     `users` table happens to exist (review #1).
//
// Failure-safe: any failure here logs but does NOT throw. The user's
// first query will surface real DB errors loudly, and `nextly db:sync`
// remains the canonical recovery path.

import { runBoundedDiagnostic } from "./bounded-diagnostic";

interface AdapterLike {
  dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle: () => unknown;
  tableExists: (name: string) => Promise<boolean>;
  executeQuery: (sql: string) => Promise<unknown>;
}

interface LoggerLike {
  debug?: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface EnsureFirstRunSetupDeps {
  freshPushSchema: (
    dialect: "postgresql" | "mysql" | "sqlite",
    db: unknown,
    schema: Record<string, unknown>
  ) => Promise<{ statementsExecuted: string[] }>;
  getDialectTables: (dialect: string) => Record<string, unknown>;
  /**
   * Raw CREATE-TABLE/-INDEX DDL for the `nextly_schema_events` ledger. The
   * ledger is also in `getDialectTables`, so `freshPushSchema` above creates
   * it — but we still bootstrap it out-of-band here (idempotent IF NOT EXISTS)
   * to mirror `nextly migrate`'s `ensureLedger`: the ledger must exist before
   * anything records into it, independent of the push path.
   */
  getSchemaEventsDdl: (dialect: "postgresql" | "mysql" | "sqlite") => string[];
}

export interface EnsureFirstRunSetupArgs {
  adapter: AdapterLike;
  logger: LoggerLike;
  deps?: Partial<EnsureFirstRunSetupDeps>;
}

export type EnsureFirstRunSetupResult =
  | { ranSetup: true; statementsExecuted: number; durationMs: number }
  | { ranSetup: false; reason: "already_initialized" | "probe_failed" };

const PROBE_TABLE = "nextly_schema_events";

/**
 * How long a startup diagnostic may take before boot proceeds without it.
 *
 * Shared by every check on the initialized-boot path; why the wait is bounded
 * at all is explained in `./bounded-diagnostic`.
 */
const DRIFT_CHECK_TIMEOUT_MS = 2_000;

/**
 * Compare the live core tables against the running code and warn on a gap —
 * in either direction.
 *
 * One introspection answers two questions. Columns the code expects and the
 * database lacks are drift, and the operator is pointed at the upgrade.
 * Columns the database still carries that the code no longer reads — the
 * retired `access_rules` registry column, when it still holds rules — are
 * the mirror case, and the operator is told those rules are no longer
 * enforced. Both are derived from the same snapshot rather than each taking
 * their own: two snapshots of one database can disagree with each other, and
 * two bounded waits on a slow database delay the boot twice.
 *
 * Never throws, and never delays boot by more than
 * {@link DRIFT_CHECK_TIMEOUT_MS}: a database that cannot be introspected
 * promptly is a problem for whatever queries it next, not a reason to refuse
 * to start. Upgrades are an explicit step, so this reports and does not repair.
 */
export async function warnIfCoreSchemaIsBehind(
  adapter: AdapterLike,
  logger: LoggerLike,
  timeoutMs: number = DRIFT_CHECK_TIMEOUT_MS,
  runCheck: (
    a: AdapterLike,
    l: LoggerLike
  ) => Promise<void> = runCoreSchemaChecks
): Promise<void> {
  await runBoundedDiagnostic({
    run: () => runCheck(adapter, logger),
    logger,
    timeoutMs,
    timedOutMessage:
      "[nextly] Core schema check timed out; continuing startup.",
    failedMessagePrefix: "[nextly] Could not check core schema state: ",
  });
}

/** The check itself; bounded by its caller. */
async function runCoreSchemaChecks(
  adapter: AdapterLike,
  logger: LoggerLike
): Promise<void> {
  const [{ introspectLiveSnapshot }, { getCoreSchema, getCoreTableNames }] =
    await Promise.all([
      import("../domains/schema/pipeline/diff/introspect-live"),
      import("../schemas/index"),
    ]);
  const { findCoreSchemaDrift, formatCoreSchemaDriftWarning } = await import(
    "./core-schema-drift"
  );
  const [
    {
      countRetiredAccessRules,
      findRetiredAccessRulesColumns,
      formatRetiredAccessRulesWarning,
    },
    { countNulls, countRows },
  ] = await Promise.all([
    import("./retired-access-rules"),
    import("../domains/schema/pipeline/classifier/count-helpers"),
  ]);

  // 🔴 Both sides take the registry this database actually holds. Checking for
  // the legacy name on a migrated database misses the table that is really
  // there and reports the core schema as behind on every start — a warning an
  // operator cannot act on, about a database that is correct.
  const { resolveRegistryNameFromCatalog } = await import(
    "../domains/field-groups/storage/resolve-storage-names"
  );
  const coreOptions = {
    fieldGroupRegistryTable: await resolveRegistryNameFromCatalog({
      dialect: adapter.dialect,
      getDrizzle: <T>() => adapter.getDrizzle() as T,
    }),
  };
  const desired = getCoreSchema(adapter.dialect, coreOptions);
  const live = await introspectLiveSnapshot(
    adapter.getDrizzle(),
    adapter.dialect,
    getCoreTableNames(coreOptions)
  );

  const drift = findCoreSchemaDrift(live, desired);
  if (drift.length > 0) {
    logger.warn(formatCoreSchemaDriftWarning(drift));
  }

  // The mirror case, read off the SAME snapshot: the two registry tables are
  // core tables, so their columns are already in hand. The column's presence
  // is what decides whether there is anything to count — asking a table that
  // no longer has it would be the error this check exists to avoid causing.
  const carrying = findRetiredAccessRulesColumns(live);
  if (carrying.length === 0) return;
  const found = await countRetiredAccessRules(
    adapter.getDrizzle(),
    adapter.dialect,
    carrying,
    { countNulls, countRows }
  );
  if (found.length > 0) {
    logger.warn(formatRetiredAccessRulesWarning(found));
  }
}

export async function ensureFirstRunSetup(
  args: EnsureFirstRunSetupArgs
): Promise<EnsureFirstRunSetupResult> {
  const { adapter, logger } = args;
  const deps = await resolveDeps(args.deps);

  // Probe step. tableExists failure is rare but possible (transient
  // connection blip). On failure, return without setup — registerServices
  // will continue and downstream queries will surface the real issue.
  let probeExists: boolean;
  try {
    probeExists = await adapter.tableExists(PROBE_TABLE);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `[nextly] Could not probe for first-run state (${msg}). Skipping setup.`
    );
    return { ranSetup: false, reason: "probe_failed" };
  }

  if (probeExists) {
    // The database has been set up before, so nothing here creates tables.
    // Core tables never gain columns after first run, though, so a database
    // created by an earlier release can be missing columns this one expects.
    // Report that rather than let a downstream query fail far from the cause.
    // The same pass also reports the mirror case — something the database
    // still has that the running code no longer reads. Rules left in the
    // retired `access_rules` column look exactly as they did while they were
    // enforced, so this is the only place they are named.
    await warnIfCoreSchemaIsBehind(adapter, logger);
    return { ranSetup: false, reason: "already_initialized" };
  }

  const start = Date.now();
  logger.info("[nextly] Setting up database schema...");

  try {
    const dialect = adapter.dialect;
    const staticTables = deps.getDialectTables(dialect);
    const result = await deps.freshPushSchema(
      dialect,
      adapter.getDrizzle(),
      staticTables
    );

    // `freshPushSchema` above already creates the ledger (it is in
    // getDialectTables). Only bootstrap it out-of-band as a fallback if it is
    // somehow still missing — re-running the raw DDL when it already exists
    // would fail on MySQL, whose `CREATE INDEX` has no IF NOT EXISTS. Mirrors
    // `migrate.ts`'s `ensureLedger` guard.
    if (!(await adapter.tableExists(PROBE_TABLE))) {
      for (const stmt of deps.getSchemaEventsDdl(dialect)) {
        await adapter.executeQuery(stmt);
      }
    }

    const durationMs = Date.now() - start;
    logger.info(
      `[nextly] Setup done in ${durationMs}ms (${result.statementsExecuted.length} statement(s)).`
    );
    return {
      ranSetup: true,
      statementsExecuted: result.statementsExecuted.length,
      durationMs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `[nextly] First-run setup failed: ${msg}. Run \`nextly db:sync\` to retry.`
    );
    return { ranSetup: false, reason: "probe_failed" };
  }
}

async function resolveDeps(
  injected: Partial<EnsureFirstRunSetupDeps> | undefined
): Promise<EnsureFirstRunSetupDeps> {
  if (
    injected?.freshPushSchema &&
    injected?.getDialectTables &&
    injected?.getSchemaEventsDdl
  ) {
    return injected as EnsureFirstRunSetupDeps;
  }
  const [{ freshPushSchema }, { getDialectTables }, { getSchemaEventsDdl }] =
    await Promise.all([
      import("../domains/schema/pipeline/fresh-push"),
      import("../database/index"),
      import("../domains/schema/events/schema-events-ddl"),
    ]);
  return {
    freshPushSchema: injected?.freshPushSchema ?? freshPushSchema,
    getDialectTables: injected?.getDialectTables ?? getDialectTables,
    getSchemaEventsDdl: injected?.getSchemaEventsDdl ?? getSchemaEventsDdl,
  };
}
