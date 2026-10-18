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

import {
  type ExtensionSchema,
  getActiveExtensionSchema,
} from "../domains/schema/extension/build-extension-schema";
import { classifyForMode } from "../domains/schema/pipeline/classifier/modes";
import {
  canEmitWithoutDrizzleKit,
  emitDdl,
  tableConstraintOps,
} from "../domains/schema/pipeline/ddl-emitter";
import type {
  ForeignKeySpec,
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "../domains/schema/pipeline/diff/types";
import { NextlyError } from "../errors";

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
  /**
   * Whether this same boot goes on to reconcile the core schema itself (the
   * development apply, or production's opt-in boot migrations). A table or
   * column found missing now is then about to be created, and telling the
   * operator to run `nextly migrate` would be wrong.
   */
  coreReconciledThisBoot?: boolean;
  deps?: Partial<EnsureFirstRunSetupDeps>;
  /**
   * The extension schema the caller just published, passed rather than read.
   *
   * This module is loaded through a dynamic import while `publish` is imported
   * statically, and a bundler may resolve the two to different instances of
   * the module holding the active-schema map — so reading it here returned
   * nothing while the publisher had just written two tables into it. Threading
   * the value removes the shared-state assumption instead of relying on the
   * bundler to collapse the copies.
   *
   * Optional: the CLI reaches first-run without a container, and falls back to
   * the module-level value, which is correct there because one process loads
   * this module once.
   */
  extensionSchema?: ExtensionSchema | undefined;
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
    l: LoggerLike,
    o: CoreSchemaCheckOptions
  ) => Promise<void> = runCoreSchemaChecks,
  options: CoreSchemaCheckOptions = {}
): Promise<void> {
  await runBoundedDiagnostic({
    run: () => runCheck(adapter, logger, options),
    logger,
    timeoutMs,
    timedOutMessage:
      "[nextly] Core schema check timed out; continuing startup.",
    failedMessagePrefix: "[nextly] Could not check core schema state: ",
  });
}

/**
 * Create the indexes an extension table declared.
 *
 * Separate from the table push for the reason above, and failure-safe for the
 * same reason first-run as a whole is: an index that could not be created is
 * worth reporting, and is not worth refusing to start over.
 */
async function createExtensionIndexes(
  adapter: AdapterLike,
  dialect: "postgresql" | "mysql" | "sqlite",
  logger: LoggerLike,
  specs: readonly TableSpec[]
): Promise<void> {
  const ops = specs.flatMap(spec =>
    (spec.indexes ?? []).map(index => ({
      type: "add_index" as const,
      tableName: spec.name,
      index,
    }))
  );
  if (ops.length === 0) return;

  for (const statement of emitDdl(ops, dialect)) {
    try {
      await adapter.executeQuery(statement);
    } catch (error) {
      logger.warn(
        `[nextly] could not create an extension index: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

/**
 * Replay the checks and foreign keys a fresh push could not carry.
 *
 * The table's constraints as `tableConstraintOps` lists them, rendered
 * through `generateSQL` — the same list and templates the dev-push emitter
 * uses when it creates a table on PostgreSQL or MySQL. Two renderers would
 * disagree about quoting and about which forms a dialect accepts.
 *
 * Failures warn rather than throw, matching the index replay above: a fresh
 * boot that cannot add one constraint should still finish and say so, because
 * the alternative is an installation that cannot start at all.
 */
async function createExtensionConstraints(
  adapter: AdapterLike,
  dialect: "postgresql" | "mysql" | "sqlite",
  logger: LoggerLike,
  specs: readonly TableSpec[]
): Promise<void> {
  // SQLite accepts a check or a foreign key only inside CREATE TABLE, so its
  // drizzle table declares them and the push above already created them.
  if (dialect === "sqlite") return;

  const ops = specs.flatMap(spec => tableConstraintOps(spec));
  if (ops.length === 0) return;

  const { generateSQL } = await import(
    "../domains/schema/pipeline/sql-templates/index"
  );
  for (const op of ops) {
    try {
      await adapter.executeQuery(generateSQL(op, dialect));
    } catch (error) {
      logger.warn(
        `[nextly] could not create an extension constraint on ${op.tableName}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

/**
 * `specs` without their foreign keys to code-first tables.
 *
 * First-run runs before the code-first collections', Singles' and field
 * groups' tables exist, so a key pointing at one of them cannot be added yet
 * on PostgreSQL or MySQL: the attempt failed and printed a warning, and the
 * code-first apply then created the key moments later, because it diffs the
 * extension tables beside the entities it creates. Those keys are left to that
 * apply, and `assertForeignKeysToCodeFirstTables` refuses the boot while one is
 * still missing. Every other key is replayed here as before — one to a table
 * that does not exist included, so its failure is still reported. A check
 * names no other table, so every check stays.
 */
function withoutKeysToCodeFirstTables(
  specs: readonly TableSpec[],
  codeFirstTables: ReadonlySet<string>
): TableSpec[] {
  return specs.map(spec => ({
    ...spec,
    foreignKeys: spec.foreignKeys?.filter(
      fk => !codeFirstTables.has(fk.referencesTable)
    ),
  }));
}

/** A foreign key to a code-first table found missing, and whether its target is. */
interface MissingForeignKey {
  table: string;
  key: ForeignKeySpec;
  targetExists: boolean;
}

/** What `assertForeignKeysToCodeFirstTables` reads, the database's two answers injectable. */
interface CodeFirstKeysCheck {
  adapter: AdapterLike;
  specs: readonly TableSpec[];
  /** The code-first tables the schema was compiled against. */
  codeFirstTables: ReadonlySet<string>;
  /** The live tables named; the pipeline's introspection unless injected. */
  introspect?: (tables: string[]) => Promise<NextlySchemaSnapshot>;
  /** Whether a table holds any row; the pipeline's row count unless injected. */
  hasRows?: (table: string) => Promise<boolean>;
}

/**
 * Refuse a boot whose extension tables, while they hold no rows, lack a
 * foreign key to a code-first table.
 *
 * A code-first collection's, Single's or field group's table is created after
 * first-run, by the code-first apply, and that apply adds the keys extension
 * tables declare to it. When it could not — the apply failed, or a target was
 * never created — the extension table kept no key and accepted rows pointing
 * at nothing, while the boot carried on with a warning.
 *
 * Asked on every boot, not only the one that created the tables. An apply can
 * commit part of its work, MySQL's DDL above all, so a restart after a refusal
 * finds the code-first tables in place and nothing left to create; only asking
 * again keeps the missing key from being forgotten. A table holding no rows is
 * in the state a fresh install left it: a missing key there can only mean its
 * creation failed, and nothing stops it being added. A table with rows is left
 * alone, because a key missing there is drift that its rows can legitimately
 * block, which the development push, `nextly db:sync` and migrations reconcile.
 *
 * Only keys to `codeFirstTables` are asked about. A key to a table the boot
 * never creates — one made in the Builder, or an adopted one — belongs to
 * migrations and the development push, and refusing it here would stop a fresh
 * install from ever starting. A holding table that does not exist yet is left
 * to whatever creates it, which adds its keys with it.
 *
 * Present is decided by the pipeline's own diff of the live tables against
 * their specs, so this asks the question the code-first apply answered, in the
 * same terms. A missing target is asked of the database directly: SQLite keeps
 * a key in its CREATE TABLE whether or not the table it names exists.
 */
export async function assertForeignKeysToCodeFirstTables(
  args: CodeFirstKeysCheck
): Promise<void> {
  const keyed = specsKeyedTo(args.specs, args.codeFirstTables);
  if (keyed.length === 0) return;

  const live = await liveTables(
    args,
    keyed.map(spec => spec.name)
  );
  const existing = new Set(live.tables.map(table => table.name));
  const holding = keyed.filter(spec => existing.has(spec.name));
  if (holding.length === 0) return;

  const absent = await absentTargets(args.adapter, holding);
  const missing = [
    ...keysWithoutTarget(holding, absent),
    ...(await keysNotCreated(live, holding, absent)),
  ];
  const refused = await onTablesWithoutRows(args, missing);
  if (refused.length > 0) throw codeFirstKeysRefusal(refused);
}

/** Each spec with only its keys to `tables`, and only the specs with any. */
function specsKeyedTo(
  specs: readonly TableSpec[],
  tables: ReadonlySet<string>
): Array<TableSpec & { foreignKeys: ForeignKeySpec[] }> {
  return specs
    .map(spec => ({
      ...spec,
      foreignKeys: (spec.foreignKeys ?? []).filter(fk =>
        tables.has(fk.referencesTable)
      ),
    }))
    .filter(spec => spec.foreignKeys.length > 0);
}

/** The live tables named, through the pipeline's introspection unless injected. */
async function liveTables(
  args: CodeFirstKeysCheck,
  tables: string[]
): Promise<NextlySchemaSnapshot> {
  if (args.introspect !== undefined) return args.introspect(tables);
  const { introspectLiveSnapshot } = await import(
    "../domains/schema/pipeline/diff/introspect-live"
  );
  return introspectLiveSnapshot(
    args.adapter.getDrizzle(),
    args.adapter.dialect,
    tables
  );
}

/** The keys' target tables the database does not have. */
async function absentTargets(
  adapter: AdapterLike,
  specs: readonly TableSpec[]
): Promise<Set<string>> {
  const targets = new Set(
    specs.flatMap(spec =>
      (spec.foreignKeys ?? []).map(fk => fk.referencesTable)
    )
  );
  const absent = new Set<string>();
  for (const target of targets) {
    if (!(await adapter.tableExists(target))) absent.add(target);
  }
  return absent;
}

/** The keys whose target table does not exist, whatever the table holds. */
function keysWithoutTarget(
  holding: ReadonlyArray<TableSpec & { foreignKeys: ForeignKeySpec[] }>,
  absent: ReadonlySet<string>
): MissingForeignKey[] {
  return holding.flatMap(spec =>
    spec.foreignKeys
      .filter(key => absent.has(key.referencesTable))
      .map(key => ({ table: spec.name, key, targetExists: false }))
  );
}

/**
 * The keys whose target exists and which the live tables still lack: what the
 * diff would add.
 */
async function keysNotCreated(
  live: NextlySchemaSnapshot,
  holding: ReadonlyArray<TableSpec & { foreignKeys: ForeignKeySpec[] }>,
  absent: ReadonlySet<string>
): Promise<MissingForeignKey[]> {
  const { diffSnapshots } = await import(
    "../domains/schema/pipeline/diff/diff"
  );
  return diffSnapshots(live, { tables: [...holding] }).flatMap(op =>
    op.type === "add_foreign_key" && !absent.has(op.foreignKey.referencesTable)
      ? [{ table: op.tableName, key: op.foreignKey, targetExists: true }]
      : []
  );
}

/** The missing keys whose table holds no rows: those the boot refuses. */
async function onTablesWithoutRows(
  args: CodeFirstKeysCheck,
  missing: readonly MissingForeignKey[]
): Promise<MissingForeignKey[]> {
  const hasRows = args.hasRows ?? (table => tableHasRows(args.adapter, table));
  const empty = new Set<string>();
  for (const table of new Set(missing.map(entry => entry.table))) {
    if (!(await hasRows(table))) empty.add(table);
  }
  return missing.filter(entry => empty.has(entry.table));
}

/** Whether `table` holds any row, by the pipeline's own count. */
async function tableHasRows(
  adapter: AdapterLike,
  table: string
): Promise<boolean> {
  const { countRows } = await import(
    "../domains/schema/pipeline/classifier/count-helpers"
  );
  return (await countRows(adapter.getDrizzle(), adapter.dialect, table)) > 0;
}

/**
 * The refusal, one entry per key, each naming its table, key and target.
 *
 * The messages are repeated as plain strings in `logContext`, because a boot
 * failure reaches the developer as the printed error object, and Node prints
 * the entries of `publicData.errors` past its default depth as `[Object]`.
 */
function codeFirstKeysRefusal(
  missing: readonly MissingForeignKey[]
): NextlyError {
  const errors = missing.map(({ table, key, targetExists }) => ({
    path: `${table}.foreignKeys.${key.name}`,
    code: "INVALID",
    message: targetExists
      ? `The foreign key "${key.name}" on "${table}" to "${key.referencesTable}" does not exist, and "${table}" holds no rows yet, so nothing stops adding it. The apply that creates code-first tables logged why it could not; fix that, then run \`nextly db:sync\`, which adds the key.`
      : `The foreign key "${key.name}" on "${table}" references "${key.referencesTable}", a code-first table that does not exist. The apply that creates code-first tables logged why it could not; fix that, then start again.`,
  }));
  return NextlyError.validation({
    errors,
    logContext: { missingForeignKeys: errors.map(entry => entry.message) },
  });
}

/** The check itself; bounded by its caller. */
/** What the boot's core-schema check is told about the boot running it. */
interface CoreSchemaCheckOptions {
  /** This boot reconciles the core schema itself, later on. */
  coreReconciledThisBoot?: boolean;
}

async function runCoreSchemaChecks(
  adapter: AdapterLike,
  logger: LoggerLike,
  options: CoreSchemaCheckOptions = {}
): Promise<void> {
  const [{ introspectLiveSnapshot }, { getCoreSchema, getCoreTableNames }] =
    await Promise.all([
      import("../domains/schema/pipeline/diff/introspect-live"),
      import("../schemas/index"),
    ]);
  const {
    findCoreSchemaDrift,
    findMissingCoreTables,
    formatCoreSchemaDriftWarning,
    formatMissingCoreTablesWarning,
  } = await import("./core-schema-drift");
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

  // Tables missing outright, and tables behind by columns: two failures with
  // one remedy, each named in its own warning, read off one snapshot.
  // Not when this boot reconciles the core schema itself, a moment from now:
  // what is missing is about to be created, and the command would be wrong.
  if (!options.coreReconciledThisBoot) {
    const missingTables = findMissingCoreTables(live, desired);
    if (missingTables.length > 0) {
      logger.warn(formatMissingCoreTablesWarning(missingTables));
    }
    const drift = findCoreSchemaDrift(live, desired);
    if (drift.length > 0) {
      logger.warn(formatCoreSchemaDriftWarning(drift));
    }
  }

  // The mirror case, read off the SAME snapshot: the two registry tables are
  // core tables, so their columns are already in hand. The column's presence
  // is what decides whether there is anything to count — asking a table that
  // no longer has it would be the error this check exists to avoid causing.
  const carrying = findRetiredAccessRulesColumns(live);
  if (carrying.length > 0) {
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

  // Asked of the database directly rather than read off the snapshot above:
  // these tables are no longer core, so `getCoreTableNames` does not name them
  // and the introspection never looked for them.
  const {
    ERASE_RETIRED_AUTH_TABLES_ENV,
    findRetiredAuthTables,
    formatRetiredAuthTablesWarning,
    liveColumnsOf,
    retiredTablesNamedForErasure,
  } = await import("./retired-auth-tables");
  const retiredAuth = await findRetiredAuthTables(
    adapter.getDrizzle(),
    adapter.dialect,
    {
      tableExists: (table: string) => adapter.tableExists(table),
      columnsOf: liveColumnsOf(adapter.getDrizzle(), adapter.dialect),
      countRows,
    }
  );
  if (retiredAuth.length > 0) {
    logger.warn(
      formatRetiredAuthTablesWarning(
        retiredAuth,
        retiredTablesNamedForErasure(process.env[ERASE_RETIRED_AUTH_TABLES_ENV])
      )
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
    // The same pass also reports the mirror case — something the database
    // still has that the running code no longer reads. Rules left in the
    // retired `access_rules` column look exactly as they did while they were
    // enforced, so this is the only place they are named.
    await warnIfCoreSchemaIsBehind(adapter, logger, undefined, undefined, {
      coreReconciledThisBoot: args.coreReconciledThisBoot === true,
    });
    return { ranSetup: false, reason: "already_initialized" };
  }

  const start = Date.now();
  logger.info("[nextly] Setting up database schema...");

  try {
    const dialect = adapter.dialect;
    // Extension tables join the FIRST-RUN push as well as the incremental one.
    //
    // This path does not go through `PushSchemaPipeline.apply`, which is where
    // the extension merge otherwise happens — so on a fresh database a
    // plugin's tables were compiled, validated, owned, and never created. The
    // failure was `no such table` on the first query, with nothing between
    // boot and that query reporting a problem.
    //
    // Merged here rather than taught to `getDialectTables`: that function
    // answers "what are Nextly's own tables", which is a different question
    // with a stable answer, and widening it would make every caller of it
    // depend on plugin config.
    const extensionSchema =
      args.extensionSchema ?? getActiveExtensionSchema(dialect);
    const staticTables = {
      ...deps.getDialectTables(dialect),
      ...(extensionSchema?.drizzle ?? {}),
    };
    const result = await deps.freshPushSchema(
      dialect,
      adapter.getDrizzle(),
      staticTables
    );

    // Extension INDEXES, replayed from the spec.
    //
    // They cannot ride the push above: A3 keeps indexes off the Drizzle tables
    // deliberately, because drizzle-kit would otherwise emit its own CREATE
    // INDEX beside the replayed one and MySQL has no IF NOT EXISTS. That is
    // right for the incremental path, where `add_index` is replayed
    // separately — and it means a FRESH database got the tables and none of
    // their indexes, so a declared unique index enforced nothing.
    //
    // Emitted through the pipeline's own emitter rather than by composing SQL
    // here: the two would then disagree about quoting and about which indexes
    // a dialect can build at all.
    await createExtensionIndexes(
      adapter,
      dialect,
      logger,
      extensionSchema?.specs ?? []
    );

    // Extension CONSTRAINTS, replayed for the same reason as the indexes.
    //
    // `toDrizzleTable` leaves checks and foreign keys off on PostgreSQL and
    // MySQL exactly as it leaves indexes off, so the push above created the
    // tables and none of their integrity constraints — a declared check, a
    // declared foreign key and the check that enforces `col.enum()` all
    // enforced nothing on a fresh database. An installation that never runs
    // dev push afterwards keeps that unconstrained schema forever.
    //
    // Not the keys to code-first tables: see `withoutKeysToCodeFirstTables`.
    await createExtensionConstraints(
      adapter,
      dialect,
      logger,
      withoutKeysToCodeFirstTables(
        extensionSchema?.specs ?? [],
        extensionSchema?.codeFirstTables ?? new Set()
      )
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

/**
 * Bring an EXISTING database's extension tables up to their declarations
 * before any plugin initialises: create the tables it does not have, and add
 * to the ones it has what needs no decision.
 *
 * First-run creates every extension table, but only on a fresh database. On an
 * existing one, a plugin added or upgraded since the last boot had its tables
 * compiled and nothing to reconcile them until the development push, which
 * runs after `registerServices` — after the plugin's `init()` has already run.
 * An `init` that seeds its own table, or reads a column its new version added,
 * then failed the boot, and the push that would have repaired the table never
 * ran. Production reaches the same shapes through the plugin's migration
 * modules, which `registerServices` also applies before plugins initialise.
 *
 * Only what needs no decision: a missing table, and on an existing table the
 * columns, indexes and constraints it lacks, when the table has no other
 * change pending. A drop, a type or nullability change, a rename, or a column
 * that existing rows cannot satisfy stays with the development push, which has
 * the classifier and prompts a change to existing data needs. A table with any
 * of those is left whole: adding a renamed column here would leave the push a
 * bare drop, and it would offer to destroy the column's data rather than
 * rename it.
 *
 * Failure-safe like first-run: a table that cannot be reconciled is reported,
 * and the plugin whose `init` needs it then fails with the query that names it.
 */
export async function prepareExtensionTablesBeforeInit(args: {
  adapter: AdapterLike;
  logger: LoggerLike;
  extensionSchema: ExtensionSchema | null | undefined;
  deps?: Partial<Pick<EnsureFirstRunSetupDeps, "freshPushSchema">>;
}): Promise<{ created: string[]; altered: string[] }> {
  const { adapter, logger, extensionSchema } = args;
  if (!extensionSchema) return { created: [], altered: [] };

  const missing: TableSpec[] = [];
  const existing: TableSpec[] = [];
  for (const spec of extensionSchema.specs) {
    if (!(spec.name in extensionSchema.drizzle)) continue;
    try {
      if (await adapter.tableExists(spec.name)) existing.push(spec);
      else missing.push(spec);
    } catch (error) {
      logger.warn(
        `[nextly] could not check whether ${spec.name} exists: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const created = await createMissingTables(
    adapter,
    logger,
    extensionSchema,
    missing,
    args.deps?.freshPushSchema
  );
  const altered = await addUndecidedChanges(adapter, logger, existing);
  return { created, altered };
}

/**
 * Create `missing` with the same push, index replay and constraint replay
 * first-run uses, so a table created here is the table first-run would have
 * created.
 */
async function createMissingTables(
  adapter: AdapterLike,
  logger: LoggerLike,
  extensionSchema: ExtensionSchema,
  missing: readonly TableSpec[],
  injectedPush: EnsureFirstRunSetupDeps["freshPushSchema"] | undefined
): Promise<string[]> {
  if (missing.length === 0) return [];
  const dialect = adapter.dialect;
  try {
    const freshPushSchema =
      injectedPush ??
      (await import("../domains/schema/pipeline/fresh-push")).freshPushSchema;
    await freshPushSchema(
      dialect,
      adapter.getDrizzle(),
      Object.fromEntries(
        missing.map(spec => [spec.name, extensionSchema.drizzle[spec.name]])
      )
    );
  } catch (error) {
    logger.warn(
      `[nextly] could not create extension tables ${missing
        .map(spec => spec.name)
        .join(", ")}: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
  await createExtensionIndexes(adapter, dialect, logger, missing);
  await createExtensionConstraints(adapter, dialect, logger, missing);
  return missing.map(spec => spec.name);
}

/** The operations this pass may run against a table that already exists. */
const ADDITIVE_OP_TYPES = new Set<Operation["type"]>([
  "add_column",
  "add_index",
  "add_check",
  "add_foreign_key",
]);

/**
 * Add to each existing table the columns, indexes and constraints its
 * declaration has and the database lacks, when nothing else about the table
 * is pending. Returns the tables changed.
 *
 * Diffed exactly as the development push diffs them — the live tables
 * against the compiled specs — and judged by the push's own `dev-additive`
 * classification, so "needs no decision" has one answer.
 */
async function addUndecidedChanges(
  adapter: AdapterLike,
  logger: LoggerLike,
  existing: readonly TableSpec[]
): Promise<string[]> {
  if (existing.length === 0) return [];
  const operations = await diffExistingTables(adapter, logger, existing);
  if (operations === undefined) return [];
  const { generateSQL } = await import(
    "../domains/schema/pipeline/sql-templates/index"
  );

  const altered: string[] = [];
  for (const spec of existing) {
    const statements = undecidedStatements(
      operations.filter(op => "tableName" in op && op.tableName === spec.name),
      adapter.dialect,
      op => generateSQL(op, adapter.dialect)
    );
    if (statements.length === 0) continue;
    if (await runTableStatements(adapter, logger, spec.name, statements)) {
      altered.push(spec.name);
    }
  }
  return altered;
}

/** The live tables diffed against their specs, or `undefined` if unreadable. */
async function diffExistingTables(
  adapter: AdapterLike,
  logger: LoggerLike,
  existing: readonly TableSpec[]
): Promise<Operation[] | undefined> {
  const [{ introspectLiveSnapshot }, { diffSnapshots }] = await Promise.all([
    import("../domains/schema/pipeline/diff/introspect-live"),
    import("../domains/schema/pipeline/diff/diff"),
  ]);
  try {
    const live = await introspectLiveSnapshot(
      adapter.getDrizzle(),
      adapter.dialect,
      existing.map(spec => spec.name)
    );
    return diffSnapshots(live, { tables: [...existing] });
  } catch (error) {
    logger.warn(
      `[nextly] could not compare extension tables with their declarations: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}

/**
 * Whether every operation pending on one table is an addition the
 * development push would make without asking.
 *
 * `dev-additive` never refuses; it sorts each operation into what it applies
 * and what it skips for a decision. Any skipped operation leaves the table
 * whole to the push, and so does any applied one that is not an addition.
 */
function needsNoDecision(
  tableOps: Operation[],
  dialect: AdapterLike["dialect"]
): boolean {
  const verdict = classifyForMode(tableOps, dialect, "dev-additive");
  return (
    verdict.verdict === "apply" &&
    verdict.skipped.length === 0 &&
    tableOps.every(op => ADDITIVE_OP_TYPES.has(op.type))
  );
}

/**
 * The statements adding one table's pending additions, or none when the
 * table is the development push's to change.
 *
 * Each kind through the renderer the push uses for it, and only where that
 * renderer can spell it. What is left over — an index MySQL needs column
 * types to key, a constraint SQLite accepts only in a rebuilt CREATE TABLE —
 * is the push's, and is missing from `init`'s view only until the push runs.
 */
function undecidedStatements(
  tableOps: Operation[],
  dialect: AdapterLike["dialect"],
  renderConstraint: (op: Operation) => string
): string[] {
  if (tableOps.length === 0 || !needsNoDecision(tableOps, dialect)) return [];
  const columns = tableOps.filter(op => op.type === "add_column");
  if (columns.length > 0 && !canEmitWithoutDrizzleKit(columns, dialect)) {
    return [];
  }
  const indexes = tableOps.filter(op => op.type === "add_index");
  const constraints =
    dialect === "sqlite"
      ? []
      : tableOps.filter(
          op => op.type === "add_check" || op.type === "add_foreign_key"
        );
  return [
    ...emitDdl(columns, dialect),
    ...(canEmitWithoutDrizzleKit(indexes, dialect)
      ? emitDdl(indexes, dialect)
      : []),
    ...constraints.map(renderConstraint),
  ];
}

/** Run one table's statements in order; reports and stops at a failure. */
async function runTableStatements(
  adapter: AdapterLike,
  logger: LoggerLike,
  table: string,
  statements: readonly string[]
): Promise<boolean> {
  try {
    for (const statement of statements) {
      await adapter.executeQuery(statement);
    }
    return true;
  } catch (error) {
    logger.warn(
      `[nextly] could not update extension table ${table}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
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
