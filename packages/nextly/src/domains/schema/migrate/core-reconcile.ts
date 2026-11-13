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
import {
  findCoreSchemaDrift,
  findMissingCoreTables,
} from "../../../init/core-schema-drift";
import { getCoreSchema, getCoreTableNames } from "../../../schemas/core-schema";
import {
  bindIssuedTokens,
  type BindIssuedTokensResult,
} from "../../auth/services/token-account-binding";
import {
  RETAINED_SIZES_COLUMN,
  RETIRED_SIZES_COLUMN,
} from "../../media/retired-image-sizes-constants";
import { markUnrecordedVerifications } from "../../users/services/email-verification-write";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import {
  coreContributions,
  type EntityContributionSource,
  onlyElements,
  withoutElements,
} from "../extension/entity-contributions";
import { isDestructive, reasonFor } from "../pipeline/classifier/modes";
import { diffSnapshots } from "../pipeline/diff/diff";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import type { NextlySchemaSnapshot, Operation } from "../pipeline/diff/types";
import {
  freshPushSchema,
  planFreshPush,
  UnplannablePushError,
  type FreshPushDialect,
} from "../pipeline/fresh-push";
import {
  assertSchemaLockHeld,
  markedForSchemaLock,
} from "../pipeline/schema-lock";
import { coreTableWithLiveContributions } from "../services/core-table-contributions";

import {
  bundleCarryingRetiredColumns,
  CORE_UPGRADE_STEPPING_STONE,
  coreDeletionOf,
  isCoreDrop,
  retiredCoreColumns,
} from "./core-retired-columns";
import {
  consentToCover,
  countDeletions,
  describeDeletion,
  judgeDataLoss,
  type DataLossConsent,
  type Deletion,
} from "./data-loss-consent";
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
  /**
   * The development boot's setting: a destructive core change is not refused,
   * and a retired column is kept rather than dropped (only consent drops one).
   * Ignored where `judgeDeletions` or `consent` is given.
   */
  allowDestructive?: boolean;
  /**
   * Decides the core upgrade's deletions before any statement runs (each
   * retired column or table, each type change, each column made required):
   * returns to proceed, throws to refuse. Given, the retired columns and
   * tables it accepts are dropped once the push has succeeded. `nextly
   * migrate` and `upgrade --reconcile-core` pass one that asks at a terminal
   * before their lock and accepts under it only what was agreed.
   */
  judgeDeletions?: (deletions: readonly Deletion[]) => Promise<void>;
  /**
   * The run's data-loss consent, judged without asking anyone: what
   * `judgeDeletions` does where no person can be asked. Ignored where
   * `judgeDeletions` is given.
   */
  consent?: DataLossConsent;
  /**
   * NEXTLY_DROP_RETIRED_AUTH_TABLES=1: drop the retired `accounts`,
   * `sessions` and `user_permission_cache` tables. Its own flag rather than `allowDestructive`, which
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
  /**
   * Executes one DDL statement: the retired auth tables' drop and a retired
   * core column's or table's drop. Each goes only after the schema lock has
   * been asserted held, marked with the run's claim.
   */
  executeSql?: (sql: string) => Promise<unknown>;
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
   * Injectable for tests. Default: `planFreshPush` over the same bundle: the
   * statements the push would run, which a dry run names.
   */
  planPush?: (
    dialect: FreshPushDialect,
    db: unknown,
    schema: Record<string, unknown>
  ) => Promise<{ runnable: string[]; blocked: string[]; degraded: boolean }>;
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
  /**
   * Injectable for tests. Default: `bindIssuedTokens`, which binds each reset
   * and verification token issued before tokens recorded their account to the
   * account it was issued for, and removes the ones it cannot.
   */
  bindIssuedTokens?: (
    db: unknown,
    dialect: Dialect
  ) => Promise<BindIssuedTokensResult>;
}

/**
 * Bring the core tables to the current core schema, then fill in the core rows
 * a new column leaves without a value it can state (see `fillCoreData`), on
 * every run.
 *
 * In order, with nothing changed before the first write:
 * 1. the core tables are diffed from the database as it stands, never from a
 *    record of how far an earlier run got, so a run that stopped part-way
 *    (killed, its connection lost, or out of tries for a busy table) is
 *    finished from where it stopped;
 * 2. what the upgrade deletes is judged (`decideDeletions`): refused, named,
 *    unless the consent covers it;
 * 3. the push brings every table up, each retired column carried in it as the
 *    live table has it, so nothing pairs; a push drizzle-kit cannot plan is
 *    refused before its first statement (`NEXTLY_CORE_UPGRADE_UNSUPPORTED`);
 * 4. every core table is checked for every column this version declares
 *    (`NEXTLY_CORE_UPGRADE_INCOMPLETE`, never a success with columns missing);
 * 5. the core rows are filled, then the retired columns and tables the consent
 *    covers are dropped, each by its own statement, recorded as it goes.
 */
export async function reconcileCore(
  deps: ReconcileCoreDeps
): Promise<{ changed: boolean }> {
  const { db, dialect, logger } = deps;
  const { ops, bundle } = await diffCore(deps);
  const applyCore =
    deps.applyCore ??
    ((
      d: FreshPushDialect,
      database: unknown,
      schema: Record<string, unknown>
    ) => freshPushSchema(d, database, schema, { refuseUnplannable: true }));

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

  // Destructive changes are refused, or agreed to, before anything is applied.
  const drops = await decideDeletions(deps, ops);
  const pushOps = ops.filter(op => !isCoreDrop(op));

  if (pushOps.length > 0) {
    const repo = new SchemaEventsRepository(db, dialect);
    try {
      // 1. Apply the core schema first (drizzle-kit pushSchema over
      //    getDialectTables). The ledger is NOT in that set, so pushSchema sees
      //    a clean diff (no extraneous-table prompt on a fresh DB).
      // The state the push reaches: Nextly's core tables, each with the
      // contributions and the retired columns the database already holds
      // composed in, so the kit plans nothing against them — no drop, no
      // rename pairing, and on SQLite a rebuild that copies them. What is not
      // yet live stays out; adding it is the app migration stream's.
      const result = await applyCore(dialect, db, bundle);

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
      if (err instanceof UnplannablePushError) {
        throw coreUpgradeUnsupported(pushOps, err);
      }
      // applyCore/bootstrap may have failed before the ledger exists, so we
      // can't reliably record a failed event — surface the error instead.
      const message = err instanceof Error ? err.message : String(err);
      throw new NextlyError({
        code: "NEXTLY_MIGRATION_APPLY_FAILED",
        publicMessage: `Core schema apply failed: ${message}`,
      });
    }
    // Every declared column is there, or the run says which are not.
    await assertCoreComplete(deps);
  }

  // After the apply, which is what adds the columns being filled. Outside the
  // `try`, so a failure here is reported as itself rather than as a failed
  // apply.
  const filled = await fillCoreData(deps);

  // The retired columns and tables the consent covers, once the push has
  // succeeded: a failed push leaves their values where they were. A run
  // stopped between two drops is finished by the next, whose diff still
  // plans the one left and whose consent covers it as this one's did.
  await executeCoreDrops(deps, drops);

  // Only once the core apply has succeeded. The drop is irreversible and the
  // apply is not guaranteed: dropping first, a failed apply would leave a
  // database without the retired tables' rows AND without the core update,
  // with no way back to where it started. Outside the `try`, so a failed drop
  // is reported as itself rather than as a failed apply. Decided here, on
  // counts taken after the apply, so a table that gained rows in the meantime
  // is kept rather than dropped on a stale count.
  const retiredTables = await executeRetiredDrops(
    deps,
    await decideRetiredDrops(deps)
  );
  // A run that kept everything it would delete, and had nothing else to do,
  // changed nothing.
  return {
    changed:
      pushOps.length > 0 ||
      drops.length > 0 ||
      filled ||
      retiredTables.length > 0,
  };
}

/**
 * What the core upgrade among `ops` deletes, with counts where the database
 * can be read: each retired column or table, each type change, each column
 * made required (`coreDeletionOf`), from the same destructive judgement a
 * production run refuses on (`destructiveOpsOf`).
 */
async function coreDeletionsAmong(
  deps: Pick<ReconcileCoreDeps, "db" | "dialect">,
  ops: Operation[]
): Promise<{ destructive: Operation[]; deletions: Deletion[] }> {
  const destructive = await destructiveOpsOf(deps.db, ops);
  if (destructive.length === 0) return { destructive, deletions: [] };
  const named = await Promise.all(
    destructive.map(op => withRequiredCount(deps, op, coreDeletionOf(op)))
  );
  return {
    destructive,
    deletions: await countDeletions(named, deps.db, deps.dialect),
  };
}

/**
 * A column made required is counted by the rows it would fail on, those
 * holding NULL, rather than by the values it keeps. Left uncounted where the
 * database cannot be read.
 */
async function withRequiredCount(
  deps: Pick<ReconcileCoreDeps, "db" | "dialect">,
  op: Operation,
  deletion: Deletion
): Promise<Deletion> {
  if (op.type !== "change_column_nullable" || deletion.kind !== "column") {
    return deletion;
  }
  try {
    const { countNulls } = await import("../pipeline/classifier/count-helpers");
    return {
      ...deletion,
      count: await countNulls(
        deps.db,
        deps.dialect,
        op.tableName,
        op.columnName
      ),
    };
  } catch {
    return { ...deletion, count: undefined };
  }
}

/**
 * The deletions a core upgrade would make, read-only: what `nextly migrate`
 * lists and asks about before its lock, with the app files' deletions.
 */
export async function planCoreDeletions(
  deps: ReconcileCoreDeps
): Promise<Deletion[]> {
  const { ops } = await diffCore(deps);
  return (await coreDeletionsAmong(deps, ops)).deletions;
}

/**
 * Refuses or agrees to what the core upgrade deletes, before anything is
 * applied, and returns the drops to make once the push has succeeded.
 *
 * - `judgeDeletions` or `consent` given: the deletions are judged by the one
 *   data-loss consent; agreed, every retired column and table is dropped.
 * - Neither: refused, naming each deletion and the consent, unless
 *   `allowDestructive` (the development boot), which applies the rest and
 *   keeps what it would drop.
 */
async function decideDeletions(
  deps: ReconcileCoreDeps,
  ops: Operation[]
): Promise<Operation[]> {
  const { destructive, deletions } = await coreDeletionsAmong(deps, ops);
  if (destructive.length === 0) return [];
  const drops = destructive.filter(isCoreDrop);

  const judge =
    deps.judgeDeletions ??
    (deps.consent === undefined
      ? undefined
      : (list: readonly Deletion[]) => judgeWithoutAsking(deps, list));
  if (judge !== undefined) {
    await judge(deletions);
    return drops;
  }
  if (!deps.allowDestructive) throw coreDestructiveRefused(deletions);
  if (drops.length > 0) deps.logger?.warn?.(leftInPlaceMessage(drops));
  return [];
}

/** The consent of `deps`, judged with nobody to ask. */
async function judgeWithoutAsking(
  deps: ReconcileCoreDeps,
  deletions: readonly Deletion[]
): Promise<void> {
  const verdict = await judgeDataLoss({
    deletions,
    consent: deps.consent as DataLossConsent,
    interactive: false,
    ask: () => Promise.resolve(false),
    print: line => deps.logger?.warn?.(line),
  });
  if (verdict.kind === "refused") {
    throw new NextlyError({
      code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
      publicMessage: verdict.message,
    });
  }
  if (verdict.kind === "declined") throw coreDestructiveRefused(deletions);
}

/**
 * A strict run's refusal with no consent to judge by: each deletion, named,
 * and the consent that covers them (R-9, R-13).
 */
export function coreDestructiveRefused(
  deletions: readonly Deletion[]
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
    publicMessage: coreDestructiveRefusedMessage(deletions),
  });
}

/** The words of `coreDestructiveRefused`. */
function coreDestructiveRefusedMessage(
  deletions: readonly Deletion[]
): string {
  return (
    "Bringing Nextly's own tables up to date deletes data: " +
    deletions.map(describeDeletion).join("; ") +
    `. Nothing was changed. To go ahead, give consent: ${consentToCover(deletions)}` +
    ". NEXTLY_ALLOW_CORE_DESTRUCTIVE=1 still works for Nextly's own tables but is deprecated."
  );
}

/**
 * A push drizzle-kit cannot plan, as the operator reads it: the tables it
 * changes, and the release to migrate with first (R-9, #387).
 */
export function coreUpgradeUnsupported(
  pushOps: readonly Operation[],
  cause?: unknown
): NextlyError {
  const tables = [
    ...new Set(
      pushOps.flatMap(op => {
        const table = tableOf(op);
        return table === undefined ? [] : [table];
      })
    ),
  ].sort();
  return new NextlyError({
    code: "NEXTLY_CORE_UPGRADE_UNSUPPORTED",
    publicMessage: coreUpgradeUnsupportedMessage(tables),
    ...(cause instanceof Error
      ? { logContext: { reason: cause.message } }
      : {}),
  });
}

/** The words of `coreUpgradeUnsupported`. */
function coreUpgradeUnsupportedMessage(
  tables: readonly string[]
): string {
  const named = tables.length === 0 ? "Nextly's own tables" : tables.join(", ");
  return (
    `This version of Nextly cannot bring ${named} up to date from this database in one step, ` +
    "so it changed nothing. " +
    `Run \`npx nextly@${CORE_UPGRADE_STEPPING_STONE} migrate\` first, then this version's \`nextly migrate\`.`
  );
}

/** The table an operation changes. */
function tableOf(op: Operation): string | undefined {
  if (op.type === "add_table") return op.table.name;
  if (op.type === "rename_table") return op.toName;
  return "tableName" in op ? op.tableName : undefined;
}

/**
 * Every core table, after the push, with every column this version declares:
 * a column still missing is named, never reported as reconciled (R-9, #387).
 */
async function assertCoreComplete(deps: ReconcileCoreDeps): Promise<void> {
  const coreOptions = {
    fieldGroupRegistryTable: deps.fieldGroupRegistryTable,
  };
  const desired = getCoreSchema(deps.dialect, coreOptions);
  const introspect = deps.introspect ?? introspectLiveSnapshot;
  const live = await introspect(
    deps.db,
    deps.dialect,
    getCoreTableNames(coreOptions)
  );
  const missingTables = findMissingCoreTables(live, desired);
  const missingColumns = findCoreSchemaDrift(live, desired);
  if (missingTables.length === 0 && missingColumns.length === 0) return;
  const what = [
    ...missingTables.map(table => `table ${table}`),
    ...missingColumns.map(
      drift => `${drift.table}: ${drift.missingColumns.join(", ")}`
    ),
  ];
  throw coreUpgradeIncomplete(what);
}

/** A core upgrade that ran and left `what` out (each a table, or a table's columns). */
export function coreUpgradeIncomplete(what: readonly string[]): NextlyError {
  return new NextlyError({
    code: "NEXTLY_CORE_UPGRADE_INCOMPLETE",
    publicMessage:
      `The core upgrade ran, but Nextly's own tables still lack what this version declares (${what.join("; ")}). ` +
      `Run \`npx nextly@${CORE_UPGRADE_STEPPING_STONE} migrate\` first, then this version's \`nextly migrate\`.`,
  });
}

/**
 * Drop the retired columns and tables agreed to, each by its own statement,
 * each recorded in the ledger as it goes, so a later one that fails leaves the
 * earlier ones on record.
 */
async function executeCoreDrops(
  deps: ReconcileCoreDeps,
  drops: readonly Operation[]
): Promise<void> {
  if (drops.length === 0) return;
  const { generateSQL } = await import("../pipeline/sql-templates");
  for (const op of drops) {
    if (!isCoreDrop(op)) continue;
    const target =
      op.type === "drop_column"
        ? `${op.tableName}.${op.columnName}`
        : op.tableName;
    await runCoreStatement(deps, generateSQL(op, deps.dialect));
    deps.logger?.warn?.(
      `Dropped retired ${op.type === "drop_column" ? "column" : "table"} ${target}.`
    );
    await recordRetiredDrop(deps, target);
  }
}

/** One statement on the core tables, under the run's schema lock. */
async function runCoreStatement(
  deps: ReconcileCoreDeps,
  statement: string
): Promise<void> {
  // A run that lost the schema lock starts no drop, and the drop carries the
  // run's claim so a run taking the lock over can find and stop it.
  await assertSchemaLockHeld();
  const marked =
    deps.dialect === "sqlite" ? statement : markedForSchemaLock(statement);
  if (deps.executeSql !== undefined) {
    await deps.executeSql(marked);
    return;
  }
  const { sql } = await import("drizzle-orm");
  if (deps.dialect === "sqlite") {
    (deps.db as { run: (q: unknown) => unknown }).run(sql.raw(marked));
    return;
  }
  await (deps.db as { execute: (q: unknown) => Promise<unknown> }).execute(
    sql.raw(marked)
  );
}

/**
 * The core tables as the database has them, set against the core schema this
 * version declares, and the operations that bring the one to the other. Reads
 * only; `reconcileCore` applies the operations and `planCoreReconcile` names
 * them.
 */
async function diffCore(deps: ReconcileCoreDeps) {
  const { db, dialect } = deps;
  const introspect = deps.introspect ?? introspectLiveSnapshot;
  // The registry name travels with every one of the three: the shape to compare
  // against, the list of tables to ask the database about, and the bundle the
  // push creates from. A mismatch between them asks about a table that is not
  // there, then diffs the answer against one that is, and creates it.
  const coreOptions = {
    fieldGroupRegistryTable: deps.fieldGroupRegistryTable,
  };
  const desired = getCoreSchema(dialect, coreOptions);
  // The elements hooks contributed to core tables, from the same derivation
  // the app's migration stream creates them with. This reconcile judges the
  // core tables on Nextly's own elements only: a contributed column is not a
  // column the core declaration lost, and reading it as one proposed dropping
  // it on every run after the app's migration added it.
  const introspected = await introspect(
    db,
    dialect,
    getCoreTableNames(coreOptions)
  );
  // The retired `sizes` column, while the database has it, is carried as if
  // contributed to the media table: set aside from the comparison, so the
  // diff never plans its drop, and composed into the state the push reaches,
  // so drizzle-kit plans nothing against it either. On SQLite a rebuild of
  // the media table would otherwise copy only the declared columns and lose
  // every item's record of its size files. Neither this nor any migration
  // drops it: `nextly media remove-sizes --apply --drop` does, once the
  // release that no longer reads it is serving and nothing names a file in it.
  const contributions = withRetainedSizesColumn(
    deps.contributions,
    introspected
  );
  const contributed = coreContributions(desired.tables, contributions, dialect);
  const live: NextlySchemaSnapshot = {
    ...introspected,
    tables: introspected.tables.map(table => {
      const own = contributed.get(table.name);
      return own === undefined ? table : withoutElements(table, own.names);
    }),
  };
  const ops = diffSnapshots(live, desired);
  // The state the push reaches: Nextly's core tables, each with the
  // contributions the database already holds composed in, so the kit plans
  // nothing against them (no drop, and on SQLite a rebuild that copies them).
  // What is not yet live stays out; adding it is the app migration stream's.
  // And each retired column, as the live table has it: the push then plans
  // no drop of it and pairs nothing against a column this table gains, which
  // is what made drizzle-kit crash or add nothing (#387). Nextly drops it
  // itself, under consent (`executeCoreDrops`).
  const bundle = bundleCarryingRetiredColumns(
    pushBundleWithLiveContributions(
      getDialectTablesForPush(dialect, coreOptions),
      contributed,
      introspected,
      contributions,
      dialect
    ),
    retiredCoreColumns(ops, live),
    dialect
  );
  return { ops, bundle };
}

/**
 * The changes among `ops` that can lose data or fail on existing rows, as
 * production-strict judges them (`isDestructive`): what a production run
 * refuses and a development run asks to confirm, from this one source.
 *
 * The data is asked before DESTRUCTIVENESS is judged: requiring a column that
 * holds no NULL cannot fail on an existing row. Without this every SQLite
 * primary key reads as a pending NOT NULL addition and the whole reconcile is
 * refused on an untouched database. The apply still takes `ops` whole: a safe
 * op still has to be performed, or the constraint is never enforced.
 */
async function destructiveOpsOf(
  db: unknown,
  ops: Operation[]
): Promise<Operation[]> {
  if (ops.length === 0) return [];
  return (await resolveSafeNullabilityOps(db, ops)).filter(isDestructive);
}

/**
 * What a run that may not drop reports of the retired columns and tables it
 * keeps, and the consent that drops them.
 */
function leftInPlaceMessage(leftInPlace: readonly Operation[]): string {
  const deletions = leftInPlace.map(coreDeletionOf);
  return (
    `Left in place: ${leftInPlace.map(reasonFor).join("; ")}. ` +
    `\`nextly migrate\` drops ${leftInPlace.length === 1 ? "it" : "them"} with the consent ${consentToCover(deletions)}.`
  );
}

/** What a core reconcile would do, worked out without changing anything. */
export interface CoreReconcilePlan {
  /** The statements its push would run, in order. */
  statements: string[];
  /**
   * Whether the push would degrade and take a second pass once the first has
   * run, whose statements are not planned here.
   */
  degraded: boolean;
  /**
   * What it would delete, with counts where the database can be read: each
   * retired column or table it drops after the push, each type change and
   * each column made required. A run needs the consent to cover them.
   */
  deletions: Deletion[];
  /** The retired auth tables the run would drop, when that was asked for. */
  retiredDrops: readonly string[];
  /**
   * The refusal a run would make before its first statement, when drizzle-kit
   * cannot plan the push (`NEXTLY_CORE_UPGRADE_UNSUPPORTED`); no statements
   * are planned then.
   */
  unsupported?: string;
}

/**
 * A core reconcile's plan, from the reconcile's own diff, deletions, push plan
 * (`planFreshPush`, over the bundle carrying the retired columns) and
 * retired-table decision, read-only: no push, no ledger row, no fill and no
 * drop. The core rows a reconcile fills in are not counted here; filling them
 * is the reconcile's own write.
 */
export async function planCoreReconcile(
  deps: ReconcileCoreDeps
): Promise<CoreReconcilePlan> {
  const { ops, bundle } = await diffCore(deps);
  const retiredDrops = await decideRetiredDrops(deps);
  const { deletions } = await coreDeletionsAmong(deps, ops);
  if (ops.filter(op => !isCoreDrop(op)).length === 0) {
    return { statements: [], degraded: false, deletions, retiredDrops };
  }
  let push: Awaited<ReturnType<typeof planFreshPush>>;
  try {
    push = await (deps.planPush ?? planCorePush)(deps.dialect, deps.db, bundle);
  } catch (err) {
    if (!(err instanceof UnplannablePushError)) throw err;
    // What the run would refuse with, as it refuses: the same named error.
    return {
      statements: [],
      degraded: false,
      deletions,
      retiredDrops,
      unsupported: coreUpgradeUnsupported(
        ops.filter(op => !isCoreDrop(op)),
        err
      ).publicMessage,
    };
  }
  return {
    statements: push.runnable,
    degraded: push.degraded,
    deletions,
    retiredDrops,
  };
}

/** The core push's plan, judged unplannable as the push itself judges it. */
function planCorePush(
  dialect: FreshPushDialect,
  db: unknown,
  schema: Record<string, unknown>
) {
  return planFreshPush(dialect, db, schema, { refuseUnplannable: true });
}

/**
 * The contributions to set aside and compose in, with the retired `sizes`
 * column added for the media table when the live table still has it.
 */
function withRetainedSizesColumn(
  source: EntityContributionSource | undefined,
  live: NextlySchemaSnapshot
): EntityContributionSource | undefined {
  const media = live.tables.find(table => table.name === "media");
  if (!media?.columns.some(column => column.name === RETIRED_SIZES_COLUMN)) {
    return source;
  }
  const entityColumns = new Map(source?.entityColumns ?? []);
  entityColumns.set("media", [
    ...(entityColumns.get("media") ?? []),
    RETAINED_SIZES_COLUMN,
  ]);
  return {
    entityColumns,
    entityIndexes: source?.entityIndexes ?? new Map(),
  };
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
 * Two steps:
 * - `users.email_verified_via` for addresses verified before that column
 *   existed, marked `"legacy"` so a later decision keyed on how an address was
 *   verified can tell an unknown origin from a known one;
 * - the `user_id` of reset and verification tokens issued before that column
 *   existed: each is bound to the account it was issued for, or removed when
 *   that cannot be established (`domains/auth/services/token-account-binding`).
 */
async function fillCoreData(deps: ReconcileCoreDeps): Promise<boolean> {
  const mark = deps.markUnrecordedVerifications ?? markUnrecordedVerifications;
  const marked = await mark(deps.db, deps.dialect);
  if (marked > 0) {
    deps.logger?.info?.(
      `Marked ${marked} previously verified email address${marked === 1 ? "" : "es"} as verified by "legacy" (no record of how).`
    );
  }
  const bind = deps.bindIssuedTokens ?? bindIssuedTokens;
  const tokens = await bind(deps.db, deps.dialect);
  if (tokens.bound + tokens.removed > 0) {
    deps.logger?.info?.(
      `Bound ${tokens.bound} outstanding password-reset or email-verification link${tokens.bound === 1 ? "" : "s"} to ${tokens.bound === 1 ? "its account" : "their accounts"}; removed ${tokens.removed} that could not be tied to one safely.`
    );
  }
  return marked > 0 || tokens.bound + tokens.removed > 0;
}

/**
 * The operations the retired-table cleanup needs, when it was asked for and
 * the caller can run it; null otherwise.
 *
 * A caller without these operations cannot do this work. Said rather than
 * thrown, because what actually went
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
      `Dropped retired ${table}, but could not record it in the schema ledger: ${error instanceof Error ? error.message : String(error)}`
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
