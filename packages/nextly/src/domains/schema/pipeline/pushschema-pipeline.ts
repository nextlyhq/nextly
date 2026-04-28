// PushSchemaPipeline - the F4 Option E orchestrator.
//
// Flow:
//   Phase A: introspect live DB -> build desired snapshot -> diff -> ops
//   Phase B: rename detection (reads ops) -> prompt dispatcher -> apply resolutions
//   Phase C: pre-resolution executor (renames, drops via our SQL)
//   Phase D: pushSchema for purely-additive remainder (drizzle-kit sees no
//            rename ambiguity, so its TTY columnsResolver never fires)
//
// This replaces F3's two-pushSchema flow. drizzle-kit's pushSchema only
// fires once per apply now, AFTER pre-resolution has executed our renames
// and drops. drizzle-kit handles the remaining additive ops (add column,
// add table, type changes, etc.) and we run its emitted SQL inside the
// transaction.
//
// SAFETY: pushSchema can emit DROP TABLE for any table that exists in
// the live DB but is missing from the desired schema. We filter to strip
// DROP TABLE statements for non-managed tables before executing.
//
// On PG/SQLite: db.transaction() provides atomicity. On MySQL: DDL is
// auto-committed; F15 will add pre-flight validation. SQLite uses PRAGMA
// foreign_keys = OFF/ON wrapping per F3 PR-4.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import { generateRuntimeSchema } from "../services/runtime-schema-generator.js";

import { buildDesiredTableFromFields } from "./diff/build-from-fields.js";
import { diffSnapshots } from "./diff/diff.js";
import { introspectLiveSnapshot } from "./diff/introspect-live.js";
import type { Operation, NextlySchemaSnapshot } from "./diff/types.js";
import {
  MANAGED_TABLE_PREFIXES_REGEX,
  isManagedTable,
} from "./managed-tables.js";
import { applyResolutionsToOperations } from "./pre-resolution/apply-resolutions.js";
import { executePreResolutionOps } from "./pre-resolution/executor.js";
import {
  PromptCancelledError,
  TTYRequiredError,
} from "./prompt-dispatcher/errors.js";
import type {
  Classifier,
  DrizzleStatementExecutor,
  MigrationJournal,
  PreRenameExecutor,
  PromptDispatcher,
  RenameCandidate,
  RenameDetector,
} from "./pushschema-pipeline-interfaces.js";
import type { DesiredSchema } from "./types.js";

export interface PipelineResult {
  success: boolean;
  statementsExecuted: number;
  renamesApplied: number;
  error?: { code: string; message: string; details?: unknown };
  partiallyApplied?: boolean;
}

// Shape of drizzle-kit's pushSchema return value.
interface PushSchemaPassResult {
  statementsToExecute: string[];
  warnings: string[];
  hasDataLoss: boolean;
}

interface DrizzleKitLike {
  pushSchema: (
    schema: Record<string, unknown>,
    db: unknown
  ) => Promise<PushSchemaPassResult>;
}

interface DbTransactionRunner {
  <T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

// Marker error for drizzle-kit pushSchema failures (vs DDL exec failures).
class PushSchemaError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = "PushSchemaError";
  }
}

// Marker error for DDL exec failures from the executor or pre-resolution.
class DdlExecutionError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = "DdlExecutionError";
  }
}

export interface PushSchemaPipelineDeps {
  executor: DrizzleStatementExecutor;
  renameDetector: RenameDetector;
  classifier: Classifier;
  promptDispatcher: PromptDispatcher;
  // F4 Option E: this is now superseded by executePreResolutionOps which
  // runs SQL for confirmed renames + drops in one pass. We keep the
  // PreRenameExecutor dep on the surface for backward compat with F3-era
  // callers that wire a noop, but the rewired pipeline does NOT call
  // preRenameExecutor.execute() - the pre-resolution executor handles
  // everything. PR 4/5 callers will remove this dep.
  preRenameExecutor: PreRenameExecutor;
  migrationJournal: MigrationJournal;
}

// @internal
export interface PushSchemaPipelineTestHooks {
  _kitOverride?: DrizzleKitLike;
  _buildDrizzleSchemaOverride?: (
    desired: DesiredSchema,
    dialect: SupportedDialect
  ) => Record<string, unknown>;
  _txOverride?: DbTransactionRunner;
  // F4 Option E: test hook for the introspectLiveSnapshot call. Lets
  // unit tests stub the previous-state snapshot without a real DB.
  _introspectSnapshotOverride?: (
    db: unknown,
    dialect: SupportedDialect,
    tableNames: string[]
  ) => Promise<NextlySchemaSnapshot>;
  _executePreResolutionOverride?: (
    txOrDb: unknown,
    ops: Operation[],
    dialect: SupportedDialect
  ) => Promise<number>;
}

export class PushSchemaPipeline {
  constructor(
    private deps: PushSchemaPipelineDeps,
    private testHooks: PushSchemaPipelineTestHooks = {}
  ) {}

  async apply(args: {
    desired: DesiredSchema;
    db: unknown;
    dialect: SupportedDialect;
    source: "ui" | "code";
    promptChannel: "browser" | "terminal";
    // MySQL-only: drizzle-kit's MySQL pushSchema requires the database
    // name. PG and SQLite ignore it.
    databaseName?: string;
  }): Promise<PipelineResult> {
    const { desired, db, dialect, source, promptChannel, databaseName } = args;
    const journalId = await this.deps.migrationJournal.recordStart({
      source,
      statementsPlanned: 0,
    });

    try {
      const managedTableNames = Object.values(desired.collections).map(
        c => c.tableName
      );

      // Phase A: our diff.
      const liveSnapshot = this.testHooks._introspectSnapshotOverride
        ? await this.testHooks._introspectSnapshotOverride(
            db,
            dialect,
            managedTableNames
          )
        : await introspectLiveSnapshot(db, dialect, managedTableNames);

      const desiredSnapshot: NextlySchemaSnapshot = {
        tables: Object.values(desired.collections).map(c =>
          buildDesiredTableFromFields(
            c.tableName,
            // FieldConfig has the shape buildDesiredTableFromFields expects;
            // cast through unknown for the structural-vs-nominal type gap.
            c.fields as unknown as Parameters<
              typeof buildDesiredTableFromFields
            >[1],
            dialect
          )
        ),
      };

      const operations = diffSnapshots(liveSnapshot, desiredSnapshot);

      // Phase B: rename detection + prompt + resolution application.
      const candidates = this.deps.renameDetector.detect(operations, dialect);

      // F5 Classifier reads typed Operation[] and returns ClassificationResult
      // { level, events }. PR 1 wires the new shape with empty count
      // callbacks (noopClassifier ignores them); PR 2 supplies real callbacks
      // bound to the live DB so countNulls/countRows fire on real changes.
      const classificationResult = await this.deps.classifier.classify({
        operations,
        drizzleWarnings: [],
        hasDataLoss: false,
        countNulls: () => Promise.resolve(0),
        countRows: () => Promise.resolve(0),
        dialect,
      });

      const dispatchResult =
        candidates.length > 0 || classificationResult.level !== "safe"
          ? await this.deps.promptDispatcher.dispatch({
              candidates,
              events: classificationResult.events,
              classification: classificationResult.level,
              channel: promptChannel,
            })
          : {
              confirmedRenames: [] as RenameCandidate[],
              resolutions: [],
              proceed: true,
            };

      // Honor abort: short-circuit before any DDL fires.
      if (!dispatchResult.proceed) {
        throw new PromptCancelledError();
      }

      // PR 1 captures resolutions but doesn't consume them; PR 4 wires a
      // PreCleanupExecutor stage that reads them. Underscore prefix silences
      // the unused-var lint until then.
      const _resolutions = dispatchResult.resolutions;
      void _resolutions;

      const resolvedOps = applyResolutionsToOperations(
        operations,
        toRenameResolutions(dispatchResult.confirmedRenames, candidates)
      );

      // Phase C+D: execute pre-resolution ops, then pushSchema for the rest.
      const drizzleSchema = this.testHooks._buildDrizzleSchemaOverride
        ? this.testHooks._buildDrizzleSchemaOverride(desired, dialect)
        : this.buildDrizzleSchema(desired, dialect);

      const kit: DrizzleKitLike = this.testHooks._kitOverride
        ? this.testHooks._kitOverride
        : await this.importDrizzleKit(dialect, databaseName);

      const isSqlite = dialect === "sqlite";

      const runApply = async (tx: unknown): Promise<number> => {
        // Phase C: pre-resolution executor runs renames + drops.
        const preResExecutor =
          this.testHooks._executePreResolutionOverride ??
          executePreResolutionOps;
        try {
          await preResExecutor(tx, resolvedOps, dialect);
        } catch (err) {
          throw new DdlExecutionError(
            err instanceof Error ? err.message : String(err),
            err
          );
        }

        // Phase D: pushSchema for purely-additive remainder.
        // After pre-resolution, the live DB has had its renames + drops
        // applied INSIDE this transaction. We pass `tx` (not the outer
        // `db`) so drizzle-kit's introspection runs within the same
        // transaction and SEES the uncommitted pre-resolution changes.
        // Without this, drizzle-kit's introspection would still see the
        // old DROP+ADD ambiguity and fire its TTY prompt.
        //
        // SQLite skips db.transaction() per F3 PR-4, so `tx === db` for
        // SQLite (it's the same handle).
        let pushResult: PushSchemaPassResult;
        try {
          pushResult = await kit.pushSchema(drizzleSchema, tx);
        } catch (err) {
          throw new PushSchemaError(
            err instanceof Error ? err.message : String(err),
            err
          );
        }
        const safe = this.filterUnsafeStatements(
          pushResult.statementsToExecute
        );

        try {
          await this.deps.executor.executeStatements(tx, safe);
        } catch (err) {
          throw new DdlExecutionError(
            err instanceof Error ? err.message : String(err),
            err
          );
        }

        return safe.length;
      };

      let statementsExecuted: number;

      if (isSqlite) {
        // SQLite: skip db.transaction() per F3 PR-4 (PRAGMA-vs-tx
        // compatibility). Wrap in foreign_keys = OFF/ON instead.
        await this.runSqlitePragma(db, "PRAGMA foreign_keys = OFF");
        try {
          statementsExecuted = await runApply(db);
        } finally {
          await this.runSqlitePragma(db, "PRAGMA foreign_keys = ON");
        }
      } else {
        // PG / MySQL: db.transaction() for atomicity (PG only; MySQL DDL
        // is auto-committed regardless. F15 adds MySQL pre-flight).
        const txFn: DbTransactionRunner = this.testHooks._txOverride
          ? this.testHooks._txOverride
          : this.makeTransactionRunner(db);
        statementsExecuted = await txFn(runApply);
      }

      await this.deps.migrationJournal.recordEnd(journalId, {
        success: true,
        statementsExecuted,
      });

      return {
        success: true,
        statementsExecuted,
        renamesApplied: dispatchResult.confirmedRenames.length,
      };
    } catch (err) {
      const code = this.classifyErrorCode(err);
      await this.deps.migrationJournal.recordEnd(journalId, {
        success: false,
        statementsExecuted: 0,
        error: err,
      });
      return {
        success: false,
        statementsExecuted: 0,
        renamesApplied: 0,
        error: {
          code,
          message: err instanceof Error ? err.message : String(err),
          details: err,
        },
      };
    }
  }

  private filterUnsafeStatements(statements: string[]): string[] {
    return statements.filter(stmt => {
      const dropMatch = stmt.match(
        /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:["`]?\w+["`]?\.)?["`]?(\w+)["`]?/i
      );
      if (!dropMatch) return true;
      return isManagedTable(dropMatch[1]);
    });
  }

  private async runSqlitePragma(db: unknown, pragma: string): Promise<void> {
    interface SqliteRunClient {
      run(query: unknown): unknown;
    }
    const { sql: sqlTag } = await import("drizzle-orm");
    const dbTyped = db as SqliteRunClient;
    dbTyped.run(sqlTag.raw(pragma));
  }

  private buildDrizzleSchema(
    desired: DesiredSchema,
    dialect: SupportedDialect
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const c of Object.values(desired.collections)) {
      const { table } = generateRuntimeSchema(
        c.tableName,
        c.fields as unknown as Parameters<typeof generateRuntimeSchema>[1],
        dialect
      );
      out[c.tableName] = table;
    }
    return out;
  }

  private async importDrizzleKit(
    dialect: SupportedDialect,
    databaseName: string | undefined
  ): Promise<DrizzleKitLike> {
    const { getPgDrizzleKit, getMySQLDrizzleKit, getSQLiteDrizzleKit } =
      await import("../../../database/drizzle-kit-lazy.js");

    switch (dialect) {
      case "postgresql": {
        const kit = await getPgDrizzleKit();
        return {
          pushSchema: (schema, db) => kit.pushSchema(schema, db, ["public"]),
        };
      }
      case "mysql": {
        if (!databaseName) {
          throw new Error(
            "PushSchemaPipeline: MySQL requires databaseName in apply() args. " +
              "Caller (e.g. dev-server.ts, dispatcher) must extract the database " +
              "name from the connection URL and pass it through."
          );
        }
        const kit = await getMySQLDrizzleKit();
        return {
          pushSchema: (schema, db) => kit.pushSchema(schema, db, databaseName),
        };
      }
      case "sqlite": {
        const kit = await getSQLiteDrizzleKit();
        return {
          pushSchema: (schema, db) => kit.pushSchema(schema, db),
        };
      }
      default: {
        const exhaustive: never = dialect;
        throw new Error(`Unsupported dialect: ${String(exhaustive)}`);
      }
    }
  }

  private makeTransactionRunner(db: unknown): DbTransactionRunner {
    interface DbWithTransaction {
      transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
    }
    const dbTyped = db as DbWithTransaction;
    return fn => dbTyped.transaction(fn);
  }

  private classifyErrorCode(err: unknown): string {
    if (err instanceof PushSchemaError) return "PUSHSCHEMA_FAILED";
    if (err instanceof DdlExecutionError) return "DDL_EXECUTION_FAILED";
    // PromptDispatcher signals - distinguish "user said no" from "no TTY
    // available" so callers (HMR loop, UI handler) can render the right
    // user-facing message instead of a generic INTERNAL_ERROR.
    if (err instanceof TTYRequiredError) return "CONFIRMATION_REQUIRED_NO_TTY";
    if (err instanceof PromptCancelledError) return "CONFIRMATION_DECLINED";
    return "INTERNAL_ERROR";
  }
}

// Convert RenameCandidate[] from PromptDispatcher into RenameResolution[]
// for applyResolutionsToOperations. confirmedRenames are the candidates
// the user said "rename" to; everything else implicitly stays as
// drop_and_add (the original drop/add ops are preserved).
function toRenameResolutions(
  confirmedRenames: RenameCandidate[],
  allCandidates: RenameCandidate[]
): Array<{
  tableName: string;
  fromColumn: string;
  toColumn: string;
  choice: "rename" | "drop_and_add";
}> {
  const confirmedSet = new Set(
    confirmedRenames.map(c => `${c.tableName}::${c.fromColumn}::${c.toColumn}`)
  );
  return allCandidates.map(c => ({
    tableName: c.tableName,
    fromColumn: c.fromColumn,
    toColumn: c.toColumn,
    choice: confirmedSet.has(`${c.tableName}::${c.fromColumn}::${c.toColumn}`)
      ? "rename"
      : "drop_and_add",
  }));
}

export { MANAGED_TABLE_PREFIXES_REGEX, isManagedTable };
