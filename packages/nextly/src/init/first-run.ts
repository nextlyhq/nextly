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
 * Compare the live core tables against the running code and warn on a gap.
 *
 * Never throws and never blocks boot: a database that cannot be introspected
 * is a problem for whatever queries it next, not a reason to refuse to start.
 * Upgrades are an explicit step, so this reports and does not repair.
 */
async function warnIfCoreSchemaIsBehind(
  adapter: AdapterLike,
  logger: LoggerLike
): Promise<void> {
  try {
    const [{ introspectLiveSnapshot }, { getCoreSchema, CORE_TABLE_NAMES }] =
      await Promise.all([
        import("../domains/schema/pipeline/diff/introspect-live"),
        import("../schemas/index"),
      ]);
    const { findCoreSchemaDrift, formatCoreSchemaDriftWarning } = await import(
      "./core-schema-drift"
    );

    const desired = getCoreSchema(adapter.dialect);
    const live = await introspectLiveSnapshot(
      adapter.getDrizzle(),
      adapter.dialect,
      [...CORE_TABLE_NAMES]
    );

    const drift = findCoreSchemaDrift(live, desired);
    if (drift.length > 0) {
      logger.warn(formatCoreSchemaDriftWarning(drift));
    }
  } catch (error) {
    // Diagnostics must not be the reason a boot fails.
    logger.debug?.(
      `[nextly] Could not check core schema state: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
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
