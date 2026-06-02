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
  ) => Promise<{ statementsExecuted: string[]; applied: true }>;
  getDialectTables: (dialect: string) => Record<string, unknown>;
  /**
   * Raw CREATE-TABLE/-INDEX DDL for the `nextly_schema_events` ledger. The
   * ledger is deliberately excluded from `getDialectTables` (drizzle-kit's
   * pushSchema would treat it as drift and prompt), so it is bootstrapped
   * out-of-band here — mirroring `nextly migrate`'s `ensureLedger`. Without
   * this, an app-boot-initialized DB never gets the ledger and every
   * `nextly_schema_events` query (e.g. the schema journal) fails.
   */
  getSchemaEventsDdl: (
    dialect: "postgresql" | "mysql" | "sqlite"
  ) => string[];
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

    // Bootstrap the `nextly_schema_events` ledger out-of-band (it is not in
    // `getDialectTables`). Idempotent — the DDL uses CREATE TABLE/INDEX IF NOT
    // EXISTS. Without this, app-boot leaves the ledger missing and the probe
    // above stays false on every boot (re-running setup each time), while the
    // schema journal + builder endpoints fail with "relation does not exist".
    for (const stmt of deps.getSchemaEventsDdl(dialect)) {
      await adapter.executeQuery(stmt);
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
