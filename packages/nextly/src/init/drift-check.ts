// Boot-time first-run + drift detection.
//
// F8 PR 6: runs once during getNextly() init (after registerServices,
// before runPostInitTasks). Three outcomes:
//
//   1. First run (empty DB) — `users` table missing.
//      Action: log "[nextly] Setting up database schema..." then
//      create the static system tables via freshPushSchema. This
//      mirrors what `nextly db:sync`'s ensureCoreTables does so that
//      `next dev` against a brand-new database actually boots
//      (previously required a manual db:sync first).
//      Rationale: per Q5=B (2026-04-28), first-run gets a single
//      log line — no prompts. Dynamic collections that need tables
//      are still created by register.ts's auto-sync block (which
//      runs after this drift check).
//
//   2. Drift (live DB diverges from config.collections).
//      Action: emit ONE warning line summarising operation count.
//      Do NOT auto-apply — drift on existing tables is the job of
//      HMR (reload-config.ts during dev) or `nextly db:sync` (manual
//      CLI). Auto-applying drift at boot would be a non-TTY hazard
//      (see PR 3 review C1) and would silently mutate production
//      schemas without a TTY-prompt safety check.
//
//   3. Clean (live DB matches config or config is empty).
//      Action: log nothing. Boot continues.
//
// Failure-safe: any introspect/diff/freshPush failure is logged but
// does NOT block boot. The pipeline's HMR + db:sync paths will
// surface real errors when the user actually edits the schema.

import type {
  DesiredCollection,
  DesiredSchema,
} from "../domains/schema/pipeline/types.js";

// Minimal duck-typed adapter contract — keeps this module
// independent of the full DrizzleAdapter type.
interface AdapterLike {
  dialect: "postgresql" | "mysql" | "sqlite";
  getDrizzle: () => unknown;
  tableExists: (name: string) => Promise<boolean>;
  getCapabilities: () => { dialect: "postgresql" | "mysql" | "sqlite" };
}

interface LoggerLike {
  debug?: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

// Minimal collection shape — same field set the pipeline expects.
interface DriftCheckCollection {
  slug: string;
  tableName: string;
  fields: unknown[];
}

// Injected deps so unit tests can stub freshPushSchema +
// previewDesiredSchema without importing the heavy real impls.
export interface RunDriftCheckDeps {
  freshPushSchema: (
    dialect: "postgresql" | "mysql" | "sqlite",
    db: unknown,
    schema: Record<string, unknown>
  ) => Promise<{ statementsExecuted: string[]; applied: true }>;
  previewDesiredSchema: (args: {
    desired: DesiredSchema;
    db: unknown;
    dialect: "postgresql" | "mysql" | "sqlite";
  }) => Promise<{
    operations: unknown[];
    events: unknown[];
    candidates: unknown[];
    classification: string;
    liveSnapshot: unknown;
  }>;
}

export interface RunDriftCheckArgs {
  adapter: AdapterLike;
  collections: DriftCheckCollection[];
  logger: LoggerLike;
  // Optional dep injection — production callers should omit and let
  // runDriftCheck import the real helpers itself.
  deps?: Partial<RunDriftCheckDeps>;
}

export type RunDriftCheckResult =
  | { kind: "first_run"; applied: number }
  | { kind: "drift"; pending: number }
  | { kind: "clean" };

export async function runDriftCheck(
  args: RunDriftCheckArgs
): Promise<RunDriftCheckResult> {
  const { adapter, collections, logger } = args;
  const deps = await resolveDeps(args.deps);

  // First-run probe: `users` is the canonical static table created by
  // every Nextly setup. If it's missing, the DB is fresh.
  let usersExists: boolean;
  try {
    usersExists = await adapter.tableExists("users");
  } catch (err) {
    // Introspection failure mid-boot is rare but not impossible
    // (e.g. transient connection blip). Log + bail to clean so init
    // proceeds; if the DB really is broken, downstream calls will fail
    // loudly.
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `[nextly] Could not probe schema state (${msg}). Skipping drift check.`
    );
    return { kind: "clean" };
  }

  if (!usersExists) {
    return runFirstRunSetup({ adapter, logger, deps });
  }

  return runDriftWarning({ adapter, collections, logger, deps });
}

async function runFirstRunSetup(args: {
  adapter: AdapterLike;
  logger: LoggerLike;
  deps: RunDriftCheckDeps;
}): Promise<RunDriftCheckResult> {
  const { adapter, logger, deps } = args;
  const start = Date.now();
  logger.info("[nextly] Setting up database schema...");

  try {
    // Lazy import: avoids pulling getDialectTables (and its transitive
    // graph) when this module is only imported for type-checking.
    const { getDialectTables } = await import("../database/index.js");
    const dialect = adapter.dialect;
    const staticTables = getDialectTables(dialect);
    const result = await deps.freshPushSchema(
      dialect,
      adapter.getDrizzle(),
      staticTables
    );
    const ms = Date.now() - start;
    logger.info(
      `[nextly] Setup done in ${ms}ms (${result.statementsExecuted.length} statement(s)).`
    );
    return { kind: "first_run", applied: result.statementsExecuted.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `[nextly] First-run setup failed: ${msg}. Run \`nextly db:sync\` to retry.`
    );
    // Don't block boot — return clean so init proceeds. The user's
    // app will surface schema errors on the first query.
    return { kind: "clean" };
  }
}

async function runDriftWarning(args: {
  adapter: AdapterLike;
  collections: DriftCheckCollection[];
  logger: LoggerLike;
  deps: RunDriftCheckDeps;
}): Promise<RunDriftCheckResult> {
  const { adapter, collections, logger, deps } = args;

  // No collections in config → nothing to drift-check.
  if (collections.length === 0) return { kind: "clean" };

  // Aggregate ops across all collections. Per-collection preview keeps
  // the impl simple — pipeline preview already iterates only the
  // collections we hand it, so calling it once per collection is the
  // same cost as one big call.
  let pendingOps = 0;
  for (const collection of collections) {
    try {
      const preview = await deps.previewDesiredSchema({
        desired: {
          collections: {
            [collection.slug]: collection as unknown as DesiredCollection,
          },
          singles: {},
          components: {},
        },
        db: adapter.getDrizzle(),
        dialect: adapter.dialect,
      });
      pendingOps += preview.operations.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug?.(
        `[nextly] Drift preview failed for '${collection.slug}': ${msg} (continuing).`
      );
      // Don't surface as a warning — the user will see real failures
      // when they save the config (HMR) or run db:sync.
    }
  }

  if (pendingOps === 0) return { kind: "clean" };

  logger.warn(
    `[nextly] Detected schema drift: ${pendingOps} pending change(s). ` +
      `Save your nextly.config.ts to apply via HMR, or run \`nextly db:sync\`.`
  );
  return { kind: "drift", pending: pendingOps };
}

// Lazy-imports the real helpers in production. Tests inject `deps`
// directly and skip this branch.
async function resolveDeps(
  injected: Partial<RunDriftCheckDeps> | undefined
): Promise<RunDriftCheckDeps> {
  if (injected?.freshPushSchema && injected?.previewDesiredSchema) {
    return injected as RunDriftCheckDeps;
  }
  const [{ freshPushSchema }, { previewDesiredSchema }] = await Promise.all([
    import("../domains/schema/pipeline/fresh-push.js"),
    import("../domains/schema/pipeline/preview.js"),
  ]);
  return {
    freshPushSchema: injected?.freshPushSchema ?? freshPushSchema,
    previewDesiredSchema:
      injected?.previewDesiredSchema ?? previewDesiredSchema,
  };
}
