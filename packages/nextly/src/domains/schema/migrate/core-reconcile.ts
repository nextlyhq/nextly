/**
 * `nextly migrate` Phase 1 — core schema reconciliation (spec §4.6).
 *
 * Introspects the live core tables, diffs against `getCoreSchema(dialect)`,
 * classifies under `production-strict` (destructive core changes are refused
 * unless NEXTLY_ALLOW_CORE_DESTRUCTIVE=1), applies additive changes via the
 * existing `freshPushSchema` core-push path (drizzle-kit ALTER/ADD COLUMN),
 * and records one `core_apply` event in `nextly_schema_events`.
 *
 * The introspect + apply steps are injectable for testing the orchestration
 * without running drizzle-kit; the defaults wire the real implementations.
 *
 * @module domains/schema/migrate/core-reconcile
 * @since v0.0.3-alpha (Plan C2)
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { getTableName, isTable } from "drizzle-orm";

import { getDialectTablesForPush } from "../../../database/index";
import { NextlyError } from "../../../errors";
import { getCoreSchema, getCoreTableNames } from "../../../schemas";
import { markUnrecordedVerifications } from "../../users/services/email-verification-write";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import {
  coreContributions,
  type EntityContributionSource,
  onlyElements,
  withoutElements,
} from "../extension/entity-contributions";
import {
  classifyForMode,
  type ClassifierMode,
} from "../pipeline/classifier/modes";
import { diffSnapshots } from "../pipeline/diff/diff";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { freshPushSchema, type FreshPushDialect } from "../pipeline/fresh-push";
import { coreTableWithLiveContributions } from "../services/core-table-contributions";

import { resolveSafeNullabilityOps } from "./resolve-safe-nullability";

type Dialect = "postgresql" | "mysql" | "sqlite";

interface LoggerLike {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
}

export interface ReconcileCoreDeps {
  db: unknown;
  dialect: Dialect;
  logger?: LoggerLike;
  /** NEXTLY_ALLOW_CORE_DESTRUCTIVE=1 lets a destructive core change proceed. */
  allowDestructive?: boolean;
  /**
   * NEXTLY_DROP_RETIRED_AUTH_TABLES=1: drop the retired `accounts` and
   * `sessions` tables. Its own flag rather than `allowDestructive`, which
   * accepts destructive changes to the core schema — a different decision,
   * that an operator makes for a different reason.
   */
  dropRetiredAuthTables?: boolean;
  /**
   * NEXTLY_DROP_NONEMPTY_RETIRED=1: also drop a retired table that still holds
   * rows. Separate again, because losing rows is a different decision from
   * removing an empty table.
   */
  allowDropNonEmptyRetired?: boolean;
  /** Whether a table is present. Supplied by the CLI; absent in tests that do not exercise the drop. */
  tableExists?: (table: string) => Promise<boolean>;
  /** Row count for a table, for deciding whether a retired one is empty. */
  countRows?: (db: unknown, dialect: Dialect, table: string) => Promise<number>;
  /**
   * A table's live column names, so a table that only shares a retired name
   * is left alone. Read from the database catalogue when not supplied.
   */
  columnsOf?: (table: string) => Promise<string[]>;
  /** Executes one DDL statement. Only used for the retired-table drop. */
  executeSql?: (sql: string) => Promise<unknown>;
  /** Classifier mode for the core diff. Default: "production-strict". */
  mode?: ClassifierMode;
  /**
   * Called (non-strict path only) when the diff contains destructive ops.
   * Return true to proceed, false to abort with NEXTLY_CORE_DESTRUCTIVE_REFUSED.
   */
  confirmDestructive?: (reasons: string[]) => Promise<boolean>;
  /** Injectable for tests. Default: introspectLiveSnapshot. */
  introspect?: (
    db: unknown,
    dialect: SupportedDialect,
    tableNames: string[]
  ) => Promise<NextlySchemaSnapshot>;
  /**
   * Which field-group registry this database holds.
   *
   * 🔴 Resolved by the CALLER, which is the layer that holds an adapter, and
   * passed in rather than probed here. A probe inside this function would sit
   * in a block whose failure policy is "abort the reconcile", so a metadata
   * blip would refuse a migration; at the caller it can fail the command
   * cleanly, before anything is applied.
   *
   * Omitted means the legacy spelling, which is correct for a fresh database
   * and for every caller with no database to ask.
   */
  fieldGroupRegistryTable?: string;
  /**
   * What schema hooks contributed to the core tables — the compiled extension
   * schema's `entityColumns` / `entityIndexes`. Those elements ride the app's
   * migration stream, not this reconcile: they are set aside from the live
   * side before comparing, and the ones the database already holds are part
   * of the state the push reaches.
   */
  contributions?: EntityContributionSource;
  /**
   * Injectable for tests. Default: freshPushSchema over `schema` — the dialect
   * bundle, with each core table's live contributions composed in.
   */
  applyCore?: (
    dialect: FreshPushDialect,
    db: unknown,
    schema: Record<string, unknown>
  ) => Promise<{ statementsExecuted: string[] }>;
  /**
   * Bootstrap the `nextly_schema_events` ledger (out-of-band, idempotent).
   * Called AFTER applyCore (so drizzle-kit pushSchema doesn't see the ledger
   * as an extraneous table) and BEFORE recording the core_apply event (so the
   * insert has a table to write to). The caller wires it to `getSchemaEventsDdl`
   * guarded by a table-exists check. Omitted in unit tests (the fixture
   * pre-creates the ledger).
   */
  ensureLedger?: () => Promise<void>;
  /**
   * Injectable for tests. Default: `markUnrecordedVerifications`, which marks
   * verified addresses with no record of how as `"legacy"`. Returns how many
   * rows it changed.
   */
  markUnrecordedVerifications?: (
    db: unknown,
    dialect: Dialect
  ) => Promise<number>;
}

/**
 * Bring the core tables to the current core schema, then fill in the core rows
 * a new column leaves without a value it can state (see `fillCoreData`), on
 * every run.
 */
export async function reconcileCore(
  deps: ReconcileCoreDeps
): Promise<{ changed: boolean }> {
  const { db, dialect, logger } = deps;
  const introspect = deps.introspect ?? introspectLiveSnapshot;
  // The registry name travels with every one of the three: the shape to compare
  // against, the list of tables to ask the database about, and the bundle the
  // push creates from. A mismatch between them asks about a table that is not
  // there, then diffs the answer against one that is, and creates it.
  const coreOptions = {
    fieldGroupRegistryTable: deps.fieldGroupRegistryTable,
  };
  const applyCore = deps.applyCore ?? freshPushSchema;

  const desired = getCoreSchema(dialect, coreOptions);
  // The elements hooks contributed to core tables, from the same derivation
  // the app's migration stream creates them with. This reconcile judges the
  // core tables on Nextly's own elements only: a contributed column is not a
  // column the core declaration lost, and reading it as one proposed dropping
  // it on every run after the app's migration added it.
  const contributed = coreContributions(
    desired.tables,
    deps.contributions,
    dialect
  );
  const introspected = await introspect(
    db,
    dialect,
    getCoreTableNames(coreOptions)
  );
  const live: NextlySchemaSnapshot = {
    ...introspected,
    tables: introspected.tables.map(table => {
      const own = contributed.get(table.name);
      return own === undefined ? table : withoutElements(table, own.names);
    }),
  };
  const ops = diffSnapshots(live, desired);

  if (ops.length === 0) {
    // Rows are not schema, so "up to date" says nothing about them either: a
    // column added by an earlier run, or by a dev push, still needs its rows
    // filled in.
    const filled = await fillCoreData(deps);
    // The retired tables are NOT part of the core schema, so the diff above
    // can never mention them and "up to date" says nothing about them. Run
    // the cleanup before returning, or the ordinary upgrade — a database
    // already carrying the current core schema — is exactly the one where a
    // requested drop silently does nothing.
    const dropped = await executeRetiredDrops(
      deps,
      await decideRetiredDrops(deps)
    );
    logger?.info?.(
      dropped.length > 0
        ? `Core schema up to date; dropped retired auth tables: ${dropped.join(", ")}.`
        : "Core schema up to date."
    );
    return { changed: filled || dropped.length > 0 };
  }

  const mode: ClassifierMode = deps.mode ?? "production-strict";
  // Always compute the destructive reasons via production-strict so both the
  // strict-refuse path and the non-strict confirmation path share one source.
  // Ask the data before judging DESTRUCTIVENESS only: requiring a column that
  // holds no NULL cannot fail on an existing row. Without this every SQLite
  // primary key reads as a pending NOT NULL addition and the whole reconcile
  // is refused on an untouched database. `ops` stays whole for the apply — a
  // safe op still has to be performed, or the constraint is never enforced.
  const opsForClassification = await resolveSafeNullabilityOps(db, ops);
  const strict = classifyForMode(
    opsForClassification,
    dialect,
    "production-strict"
  );
  const destructiveReasons = strict.verdict === "refuse" ? strict.reasons : [];

  if (destructiveReasons.length > 0) {
    if (mode === "production-strict") {
      if (!deps.allowDestructive) {
        throw new NextlyError({
          code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
          publicMessage:
            "Core schema reconciliation requires destructive operations: " +
            destructiveReasons.join("; ") +
            ". This usually means a Nextly version mismatch. Set " +
            "NEXTLY_ALLOW_CORE_DESTRUCTIVE=1 to proceed (see release notes).",
        });
      }
      logger?.warn?.(
        "Applying destructive core change due to NEXTLY_ALLOW_CORE_DESTRUCTIVE=1."
      );
    } else {
      // dev-loose (and any future non-strict mode): require explicit operator
      // confirmation for the destructive set.
      const confirmed =
        (await deps.confirmDestructive?.(destructiveReasons)) ?? false;
      if (!confirmed) {
        throw new NextlyError({
          code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
          publicMessage:
            "Core schema reconciliation aborted: destructive operations were not confirmed: " +
            destructiveReasons.join("; ") +
            ".",
        });
      }
      logger?.warn?.(
        "Applying confirmed destructive core change (reconcile-core)."
      );
    }
  }

  const repo = new SchemaEventsRepository(db, dialect);
  try {
    // 1. Apply the core schema first (drizzle-kit pushSchema over
    //    getDialectTables). The ledger is NOT in that set, so pushSchema sees
    //    a clean diff (no extraneous-table prompt on a fresh DB).
    // The state the push reaches: Nextly's core tables, each with the
    // contributions the database already holds composed in, so the kit
    // plans nothing against them — no drop, and on SQLite a rebuild that
    // copies them. What is not yet live stays out; adding it is the app
    // migration stream's.
    const result = await applyCore(
      dialect,
      db,
      pushBundleWithLiveContributions(
        getDialectTablesForPush(dialect, coreOptions),
        contributed,
        introspected,
        deps.contributions,
        dialect
      )
    );

    // 2. Bootstrap the ledger out-of-band, after applyCore and before
    //    recording, so recordStart has a table to write to.
    await deps.ensureLedger?.();

    // 3. Record the core_apply event.
    const id = await repo.recordStart({
      eventType: "core_apply",
      source: "cli-migrate",
      scopeKind: "core",
    });
    await repo.markApplied(id, {
      statementsExecuted: result.statementsExecuted.length,
    });
    logger?.info?.(
      `Core schema reconciled (${result.statementsExecuted.length} statements).`
    );
  } catch (err) {
    // applyCore/bootstrap may have failed before the ledger exists, so we
    // can't reliably record a failed event — surface the error instead.
    const message = err instanceof Error ? err.message : String(err);
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      publicMessage: `Core schema apply failed: ${message}`,
    });
  }

  // After the apply, which is what adds the columns being filled. Outside the
  // `try`, so a failure here is reported as itself rather than as a failed
  // apply.
  await fillCoreData(deps);

  // Only once the core apply has succeeded. The drop is irreversible and the
  // apply is not guaranteed: dropping first, a failed apply would leave a
  // database without the retired tables' rows AND without the core update,
  // with no way back to where it started. Outside the `try`, so a failed drop
  // is reported as itself rather than as a failed apply. Decided here, on
  // counts taken after the apply, so a table that gained rows in the meantime
  // is kept rather than dropped on a stale count.
  await executeRetiredDrops(deps, await decideRetiredDrops(deps));
  return { changed: true };
}

/**
 * Fill in the core rows a column added to the core schema leaves without a
 * value it can state, and report whether any row changed.
 *
 * Run on every reconcile rather than only when the diff adds the column: a dev
 * push or `db:sync` can add a column without coming through here, and each
 * step only touches rows still missing their value, so a second run changes
 * nothing.
 *
 * Today one step: `users.email_verified_via` for addresses verified before
 * that column existed, marked `"legacy"` so a later decision keyed on how an
 * address was verified can tell an unknown origin from a known one.
 */
async function fillCoreData(deps: ReconcileCoreDeps): Promise<boolean> {
  const mark = deps.markUnrecordedVerifications ?? markUnrecordedVerifications;
  const marked = await mark(deps.db, deps.dialect);
  if (marked > 0) {
    deps.logger?.info?.(
      `Marked ${marked} previously verified email address${marked === 1 ? "" : "es"} as verified by "legacy" (no record of how).`
    );
  }
  return marked > 0;
}

/**
 * The operations the retired-table cleanup needs, when it was asked for and
 * the caller can run it; null otherwise.
 *
 * A caller without these operations cannot do this work, which is true of the
 * in-process boot path. Said rather than thrown, because what actually went
 * wrong was that the CLI supplied none of them: the cleanup returned here and
 * the documented flow dropped nothing. That is now covered by asserting what
 * the CLI passes, which is the thing that regressed.
 */
function retiredDropOps(deps: ReconcileCoreDeps): {
  tableExists: NonNullable<ReconcileCoreDeps["tableExists"]>;
  countRows: NonNullable<ReconcileCoreDeps["countRows"]>;
} | null {
  if (!deps.dropRetiredAuthTables) return null;
  const { tableExists, countRows, executeSql } = deps;
  if (!tableExists || !countRows || !executeSql) {
    deps.logger?.info?.(
      "Retired-table cleanup skipped: this caller supplies no table-existence, row-count or statement operations."
    );
    return null;
  }
  return { tableExists, countRows };
}

/**
 * The retired auth tables to drop, when the operator has asked for it.
 * Deciding only: the caller drops them, once nothing else can fail.
 *
 * A table holding rows the operator has not agreed to lose is KEPT, with a
 * warning, rather than refused: the drop is a cleanup the operator opted into,
 * and failing the run over it would hold back a core change that has nothing
 * to do with these tables.
 *
 * Separate from the diff above because these tables are no longer part of the
 * core schema: `getCoreTableNames` does not name them, so the introspection
 * never looks for them and the diff has nothing to say. Without this they
 * would simply sit in an existing database forever, which is the right default
 * but a poor only option.
 */
async function decideRetiredDrops(
  deps: ReconcileCoreDeps
): Promise<readonly string[]> {
  const ops = retiredDropOps(deps);
  if (!ops) return [];

  const {
    findRetiredAuthTables,
    planRetiredAuthTableDrop,
    formatRetiredAuthTablesKept,
    liveColumnsOf,
  } = await import("../../../init/retired-auth-tables");

  const found = await findRetiredAuthTables(deps.db, deps.dialect, {
    tableExists: ops.tableExists,
    columnsOf: deps.columnsOf ?? liveColumnsOf(deps.db, deps.dialect),
    countRows: ops.countRows,
  });
  const plan = planRetiredAuthTableDrop(found, {
    dropRequested: true,
    allowNonEmpty: deps.allowDropNonEmptyRetired === true,
  });
  if (plan.kept.length > 0) {
    deps.logger?.warn?.(formatRetiredAuthTablesKept(plan.kept));
  }
  return plan.drop;
}

/**
 * Execute the drops the plan settled on.
 *
 * Separate from deciding them, so the guards above read as the DECISION they
 * make and this reads as what carries it out.
 */
async function executeRetiredDrops(
  deps: ReconcileCoreDeps,
  tables: readonly string[]
): Promise<string[]> {
  if (tables.length === 0) return [];
  // Asked of the same generator the diff engine uses, rather than composed
  // here. Each dialect already spells this differently — PostgreSQL appends
  // CASCADE, MySQL and SQLite do not — and a second spelling in a domain
  // service is a second thing to keep in step with the dialects.
  const { generateSQL } = await import("../pipeline/sql-templates");
  const dropped: string[] = [];
  for (const table of tables) {
    await deps.executeSql?.(
      generateSQL({ type: "drop_table", tableName: table }, deps.dialect)
    );
    dropped.push(table);
    deps.logger?.warn?.(`Dropped retired auth table ${table}.`);
    // Recorded as each one goes, so a later drop that fails leaves the
    // earlier ones on record.
    await recordRetiredDrop(deps, table);
  }
  return dropped;
}

/**
 * Record one drop in the schema ledger, as the core change it is.
 *
 * After the fact and never fatal: the table is already gone, and failing the
 * command now would report a run that did what it was asked as failed. The
 * log line before it has already said what happened either way.
 */
async function recordRetiredDrop(
  deps: ReconcileCoreDeps,
  table: string
): Promise<void> {
  try {
    await deps.ensureLedger?.();
    const repo = new SchemaEventsRepository(deps.db, deps.dialect);
    const id = await repo.recordStart({
      eventType: "core_apply",
      source: "cli-migrate",
      scopeKind: "core",
      scopeSlug: table,
    });
    await repo.markApplied(id, { statementsExecuted: 1 });
  } catch (error) {
    deps.logger?.warn?.(
      `Dropped retired auth table ${table}, but could not record it in the schema ledger: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/** One table's contributions, as `coreContributions` reports them. */
type CoreContribution =
  ReturnType<typeof coreContributions> extends Map<string, infer Entry>
    ? Entry
    : never;

/** The names of a live table's elements of one kind. */
function liveElementNames(
  elements: readonly { name: string }[] | undefined
): string[] {
  return (elements ?? []).map(element => element.name);
}

/**
 * The contributed elements the live table actually has, by element name.
 * Foreign keys are never contributed to a core table, so none are kept.
 */
function liveContributedElements(
  entry: CoreContribution,
  liveTable: NextlySchemaSnapshot["tables"][number]
): ReturnType<typeof onlyElements> {
  return onlyElements(entry.elements, {
    columns: entry.names.columns.filter(column =>
      liveElementNames(liveTable.columns).includes(column)
    ),
    indexes: entry.names.indexes.filter(index =>
      liveElementNames(liveTable.indexes).includes(index)
    ),
    foreignKeys: [],
    checks: entry.names.checks.filter(check =>
      liveElementNames(liveTable.checks).includes(check)
    ),
  });
}

/**
 * One bundle entry, rebuilt with its live contributions when it is a core
 * table that was contributed to and that the database has; otherwise as is.
 */
function bundleTableWithLiveContributions(
  table: unknown,
  contributed: ReturnType<typeof coreContributions>,
  liveByName: ReadonlyMap<string, NextlySchemaSnapshot["tables"][number]>,
  source: EntityContributionSource,
  dialect: Dialect
): unknown {
  if (!isTable(table)) return table;
  const name = getTableName(table);
  const entry = contributed.get(name);
  const liveTable = liveByName.get(name);
  if (entry === undefined || liveTable === undefined) return table;
  return (
    coreTableWithLiveContributions(
      name,
      liveContributedElements(entry, liveTable),
      source.entityColumns.get(name) ?? [],
      dialect
    ) ?? table
  );
}

/**
 * The core push bundle, each contributed-to table replaced by its definition
 * rebuilt with the contributions `live` holds (`coreTableWithLiveContributions`).
 *
 * "Live" is the intersection of what was contributed with what the database
 * has, by element name — derived from the same `coreContributions` entry the
 * comparison sets aside.
 */
function pushBundleWithLiveContributions(
  bundle: Record<string, unknown>,
  contributed: ReturnType<typeof coreContributions>,
  live: NextlySchemaSnapshot,
  source: EntityContributionSource | undefined,
  dialect: Dialect
): Record<string, unknown> {
  if (contributed.size === 0 || source === undefined) return bundle;
  const liveByName = new Map(live.tables.map(table => [table.name, table]));
  const out: Record<string, unknown> = {};
  for (const [key, table] of Object.entries(bundle)) {
    out[key] = bundleTableWithLiveContributions(
      table,
      contributed,
      liveByName,
      source,
      dialect
    );
  }
  return out;
}
