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
   * NEXTLY_DROP_NONEMPTY_RETIRED=1: also drop a retired table that still holds
   * rows. Separate from `allowDestructive`, because losing rows is a different
   * decision from accepting a schema change.
   */
  allowDropNonEmptyRetired?: boolean;
  /** Whether a table is present. Supplied by the CLI; absent in tests that do not exercise the drop. */
  tableExists?: (table: string) => Promise<boolean>;
  /** Row count for a table, for deciding whether a retired one is empty. */
  countRows?: (db: unknown, dialect: Dialect, table: string) => Promise<number>;
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
}

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
    // The retired tables are NOT part of the core schema, so the diff above
    // can never mention them and "up to date" says nothing about them. Run
    // the cleanup before returning, or the ordinary upgrade — a database
    // already carrying the current core schema — is exactly the one where a
    // requested drop silently does nothing.
    await dropRetiredAuthTablesIfAllowed(deps);
    logger?.info?.("Core schema up to date.");
    return { changed: false };
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

  await dropRetiredAuthTablesIfAllowed(deps);

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
    return { changed: true };
  } catch (err) {
    // applyCore/bootstrap may have failed before the ledger exists, so we
    // can't reliably record a failed event — surface the error instead.
    const message = err instanceof Error ? err.message : String(err);
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_APPLY_FAILED",
      publicMessage: `Core schema apply failed: ${message}`,
    });
  }
}

/**
 * Drop the retired auth tables, when the operator has asked for it.
 *
 * Separate from the diff above because these tables are no longer part of the
 * core schema: `getCoreTableNames` does not name them, so the introspection
 * never looks for them and the diff has nothing to say. Without this they
 * would simply sit in an existing database forever, which is the right default
 * but a poor only option.
 */
async function dropRetiredAuthTablesIfAllowed(
  deps: ReconcileCoreDeps
): Promise<void> {
  if (!deps.allowDestructive) return;

  // `allowDestructive` is the GENERAL flag — it also authorises dropping an
  // orphaned core column — so its being set does not mean retired-table work
  // was asked for. A caller without these operations simply does not do that
  // work, which is true of the in-process boot path, and refusing here would
  // reject a destructive change that has nothing to do with these tables.
  //
  // Said rather than thrown, because what actually went wrong was that the
  // CLI supplied none of them: the cleanup returned at this guard and the
  // documented flow dropped nothing. That is now covered by asserting what
  // the CLI passes, which is the thing that regressed.
  if (!deps.tableExists || !deps.countRows || !deps.executeSql) {
    deps.logger?.info?.(
      "Retired-table cleanup skipped: this caller supplies no table-existence, row-count or statement operations."
    );
    return;
  }

  const {
    findRetiredAuthTables,
    planRetiredAuthTableDrop,
    formatRetiredAuthDropRefusal,
  } = await import("../../../init/retired-auth-tables");

  const found = await findRetiredAuthTables(deps.db, deps.dialect, {
    tableExists: deps.tableExists,
    countRows: deps.countRows,
  });
  const plan = planRetiredAuthTableDrop(found, {
    allowDestructive: true,
    allowNonEmpty: deps.allowDropNonEmptyRetired === true,
  });

  if (plan.action === "keep") return;
  if (plan.action === "refuse") {
    throw new NextlyError({
      code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
      publicMessage: formatRetiredAuthDropRefusal(plan.nonEmpty),
    });
  }

  await executeRetiredDrops(deps, plan.tables);
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
): Promise<void> {
  // Asked of the same generator the diff engine uses, rather than composed
  // here. Each dialect already spells this differently — PostgreSQL appends
  // CASCADE, MySQL and SQLite do not — and a second spelling in a domain
  // service is a second thing to keep in step with the dialects.
  const { generateSQL } = await import("../pipeline/sql-templates");
  for (const table of tables) {
    await deps.executeSql?.(
      generateSQL({ type: "drop_table", tableName: table }, deps.dialect)
    );
    deps.logger?.warn?.(`Dropped retired auth table ${table}.`);
  }
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
    const name = isTable(table) ? getTableName(table) : undefined;
    const entry = name === undefined ? undefined : contributed.get(name);
    const liveTable = name === undefined ? undefined : liveByName.get(name);
    if (name === undefined || entry === undefined || liveTable === undefined) {
      out[key] = table;
      continue;
    }
    const present = (elements: readonly { name: string }[] | undefined) =>
      (elements ?? []).map(element => element.name);
    const liveElements = onlyElements(entry.elements, {
      columns: entry.names.columns.filter(column =>
        present(liveTable.columns).includes(column)
      ),
      indexes: entry.names.indexes.filter(index =>
        present(liveTable.indexes).includes(index)
      ),
      foreignKeys: [],
      checks: entry.names.checks.filter(check =>
        present(liveTable.checks).includes(check)
      ),
    });
    out[key] =
      coreTableWithLiveContributions(
        name,
        liveElements,
        source.entityColumns.get(name) ?? [],
        dialect
      ) ?? table;
  }
  return out;
}
