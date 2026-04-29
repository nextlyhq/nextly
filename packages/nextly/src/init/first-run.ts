// First-run static-table push.
//
// F8 PR 6 (review #1+#2): on a brand-new database `next dev` would
// previously fail because static system tables (users, permissions,
// dynamic_collections, etc.) didn't exist. The fix is to create them
// inside `registerServices()` BEFORE the dynamic-table probing runs,
// so that loadDynamicTables + the auto-sync block both see a populated
// schema instead of swallowing "table not exist" errors.
//
// Probe choice: `nextly_migration_journal` (added in F8 PR 5).
//   - Namespaced with the `nextly_` prefix — only Nextly creates it.
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
}

export interface EnsureFirstRunSetupArgs {
  adapter: AdapterLike;
  logger: LoggerLike;
  deps?: Partial<EnsureFirstRunSetupDeps>;
}

export type EnsureFirstRunSetupResult =
  | { ranSetup: true; statementsExecuted: number; durationMs: number }
  | { ranSetup: false; reason: "already_initialized" | "probe_failed" };

const PROBE_TABLE = "nextly_migration_journal";

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
  if (injected?.freshPushSchema && injected?.getDialectTables) {
    return injected as EnsureFirstRunSetupDeps;
  }
  const [{ freshPushSchema }, { getDialectTables }] = await Promise.all([
    import("../domains/schema/pipeline/fresh-push.js"),
    import("../database/index.js"),
  ]);
  return {
    freshPushSchema: injected?.freshPushSchema ?? freshPushSchema,
    getDialectTables: injected?.getDialectTables ?? getDialectTables,
  };
}
