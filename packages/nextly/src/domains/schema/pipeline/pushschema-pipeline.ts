// PushSchemaPipeline — the F3 central orchestrator.
//
// Receives a DesiredSchema (full snapshot of all managed tables),
// invokes drizzle-kit's pushSchema to compute the SQL diff, runs
// the result through 5 plug-in components (RenameDetector, Classifier,
// PromptDispatcher, PreRenameExecutor, MigrationJournal — all no-op
// stubs in F3, real impls in F4-F8), and executes the final statements
// inside db.transaction().
//
// SAFETY: pushSchema can emit DROP TABLE for any table that exists in
// the live DB but is missing from the desired schema. That includes
// user app tables (`orders`, `analytics_events`), unregistered Nextly
// tables, and future plugin tables. We filter the output to strip
// DROP TABLE statements for non-managed tables before executing.
// The filter regex (MANAGED_TABLE_PREFIXES_REGEX) is the central
// integration point for Gap 8 (plugin / user-config table protection).
//
// On PG/SQLite: db.transaction() provides true atomicity — partial
// failure rolls back. On MySQL: DDL is auto-committed regardless of
// the BEGIN/COMMIT wrapper. F15 will add MySQL pre-flight validation
// to catch conflicts before any ALTER runs.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import { generateRuntimeSchema } from "../services/runtime-schema-generator.js";

import {
  MANAGED_TABLE_PREFIXES_REGEX,
  isManagedTable,
} from "./managed-tables.js";
import type {
  Classifier,
  DrizzleStatementExecutor,
  MigrationJournal,
  PreRenameExecutor,
  PromptDispatcher,
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

// Shape of the value returned by drizzle-kit's pushSchema (across
// PG / MySQL / SQLite — they all return this same shape).
interface PushSchemaPassResult {
  statementsToExecute: string[];
  warnings: string[];
  hasDataLoss: boolean;
}

// The pipeline's unified pushSchema accessor — wraps each dialect's
// kit so the orchestrator code is dialect-agnostic.
interface DrizzleKitLike {
  pushSchema: (
    schema: Record<string, unknown>,
    db: unknown
  ) => Promise<PushSchemaPassResult>;
}

interface DbTransactionRunner {
  <T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

// Internal marker error: thrown when drizzle-kit's pushSchema itself
// fails (vs a DDL execution failure later in the pipeline). The catch
// block in apply() classifies based on this constructor identity rather
// than fragile stack-string matching.
class PushSchemaError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = "PushSchemaError";
  }
}

// Same idea for DDL execution failures — distinct error code so
// callers can tell apart "drizzle-kit couldn't compute the diff" from
// "the SQL we tried to run blew up."
class DdlExecutionError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown
  ) {
    super(message);
    this.name = "DdlExecutionError";
  }
}

// Production deps. Public surface — F4-F8 implement these and consumers
// instantiate the pipeline with them.
export interface PushSchemaPipelineDeps {
  executor: DrizzleStatementExecutor;
  renameDetector: RenameDetector;
  classifier: Classifier;
  promptDispatcher: PromptDispatcher;
  preRenameExecutor: PreRenameExecutor;
  migrationJournal: MigrationJournal;
}

// Test-only override hooks. Kept off the public deps interface so
// IntelliSense for production callers stays clean. Tests pass these
// as the optional second constructor arg.
//
// @internal
export interface PushSchemaPipelineTestHooks {
  _kitOverride?: DrizzleKitLike;
  _buildDrizzleSchemaOverride?: (
    desired: DesiredSchema,
    dialect: SupportedDialect
  ) => Record<string, unknown>;
  _txOverride?: DbTransactionRunner;
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
    // name (extracted from the connection URL by the caller). Empty/
    // undefined silently no-ops on MySQL — drizzle-kit returns zero DDL
    // statements. Caller must thread this through for MySQL to work.
    // PG and SQLite ignore this. F15 will address MySQL safety further.
    databaseName?: string;
  }): Promise<PipelineResult> {
    const { desired, db, dialect, source, promptChannel, databaseName } = args;
    const journalId = await this.deps.migrationJournal.recordStart({
      source,
      statementsPlanned: 0,
    });

    try {
      // Step 2: build Drizzle schema objects from DesiredSchema.
      const drizzleSchema = this.testHooks._buildDrizzleSchemaOverride
        ? this.testHooks._buildDrizzleSchemaOverride(desired, dialect)
        : this.buildDrizzleSchema(desired, dialect);

      // Step 3: lazy-import drizzle-kit/api (F1's helper) per dialect.
      const kit: DrizzleKitLike = this.testHooks._kitOverride
        ? this.testHooks._kitOverride
        : await this.importDrizzleKit(dialect, databaseName);

      // Step 4: first pushSchema pass — get the SQL diff.
      // Wrapped in its own try/catch so we can attribute pushSchema
      // failures specifically (vs DDL execution failures below).
      let firstPassRaw;
      try {
        firstPassRaw = await kit.pushSchema(drizzleSchema, db);
      } catch (err) {
        throw new PushSchemaError(
          err instanceof Error ? err.message : String(err),
          err
        );
      }
      const firstPassSafe = this.filterUnsafeStatements(
        firstPassRaw.statementsToExecute
      );

      // Step 5: rename detection (F4 stub: returns []).
      const candidates = this.deps.renameDetector.detect(
        firstPassSafe,
        dialect
      );

      // Step 6: classification (F5 stub: returns "safe").
      const classification = this.deps.classifier.classify(
        firstPassRaw.warnings,
        firstPassRaw.hasDataLoss
      );

      // Step 7: dispatch prompts if needed (F7/F8 stub: never reached
      // when both detector and classifier return defaults).
      const confirmed =
        candidates.length > 0 || classification !== "safe"
          ? await this.deps.promptDispatcher.dispatch({
              candidates,
              classification,
              channel: promptChannel,
            })
          : { confirmedRenames: [], resolutions: {} };

      // Step 8: execute inside transaction.
      const txFn: DbTransactionRunner = this.testHooks._txOverride
        ? this.testHooks._txOverride
        : this.makeTransactionRunner(db);

      const statementsExecuted = await txFn(async (tx: unknown) => {
        // Step 8a: pre-rename ALTER TABLE RENAME COLUMN (F6 stub: no-op).
        await this.deps.preRenameExecutor.execute(
          tx,
          confirmed.confirmedRenames
        );

        // Step 8b: re-call pushSchema against post-rename DB.
        let secondPassRaw;
        try {
          secondPassRaw = await kit.pushSchema(drizzleSchema, db);
        } catch (err) {
          throw new PushSchemaError(
            err instanceof Error ? err.message : String(err),
            err
          );
        }
        const secondPassSafe = this.filterUnsafeStatements(
          secondPassRaw.statementsToExecute
        );

        // Step 8c: execute remaining statements via the executor.
        try {
          await this.deps.executor.executeStatements(tx, secondPassSafe);
        } catch (err) {
          throw new DdlExecutionError(
            err instanceof Error ? err.message : String(err),
            err
          );
        }

        return secondPassSafe.length;
      });

      // Step 9: journal end.
      await this.deps.migrationJournal.recordEnd(journalId, {
        success: true,
        statementsExecuted,
      });

      // Step 10: success result.
      return {
        success: true,
        statementsExecuted,
        renamesApplied: confirmed.confirmedRenames.length,
      };
    } catch (err) {
      // Failure path: classify error, journal end, return failure.
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

  // Strips DROP TABLE statements that target non-managed tables.
  //
  // Why only DROP TABLE: pushSchema only emits ALTER for tables present
  // in BOTH desired AND live (we never put unmanaged tables in desired,
  // so no ALTER risk). CREATE is always safe (creating a managed table).
  // DROP is the only direction where a non-managed table could be hit.
  //
  // Gap 8 integration point: extend MANAGED_TABLE_PREFIXES_REGEX (or
  // replace this filter with a richer isManagedTable() that consults
  // a plugin / user-config table list) when plugins land.
  //
  // Regex shape:
  //   - Optional schema prefix (PG): ["`]?(\w+)["`]?\.
  //   - Table name itself: ["`]?(\w+)["`]?
  //   The schema prefix is captured but discarded; we want the bare
  //   table name. Without the explicit (\w+\.)? group, the simpler
  //   ["`]?[^"`]+["`]? would capture only "public" (stopping at the
  //   first closing quote) for `"public"."dc_x"` — silently filtering
  //   out legitimate managed-table DROPs.
  private filterUnsafeStatements(statements: string[]): string[] {
    return statements.filter(stmt => {
      const dropMatch = stmt.match(
        /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:["`]?\w+["`]?\.)?["`]?(\w+)["`]?/i
      );
      if (!dropMatch) return true;
      return isManagedTable(dropMatch[1]);
    });
  }

  // Build Drizzle table objects from the DesiredSchema. Uses the existing
  // generateRuntimeSchema helper (which knows how to translate FieldConfig
  // into dialect-specific Drizzle tables).
  //
  // Singles + components silently skipped per F2's iterateResources
  // pattern. F8 wires their apply paths.
  private buildDrizzleSchema(
    desired: DesiredSchema,
    dialect: SupportedDialect
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const c of Object.values(desired.collections)) {
      const { table } = generateRuntimeSchema(
        c.tableName,
        // generateRuntimeSchema accepts the same FieldConfig shape we use
        // throughout F2; cast through unknown for the structural-vs-nominal
        // gap with FieldDefinition.
        c.fields as unknown as Parameters<typeof generateRuntimeSchema>[1],
        dialect
      );
      out[c.tableName] = table;
    }
    return out;
  }

  // Lazy-import drizzle-kit/api via F1's per-dialect helpers.
  // Wraps each dialect's kit in a unified DrizzleKitLike so the
  // orchestrator code stays dialect-agnostic.
  //
  // databaseName is required for MySQL — drizzle-kit's MySQL pushSchema
  // takes the database name as its 3rd arg. Without it, drizzle-kit
  // compares against no tables and returns zero DDL silently. Caller
  // (PR-2/PR-3 wiring) must extract this from the connection URL and
  // thread it through apply()'s args. PG and SQLite ignore it.
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
          // schemaFilters scopes to PG's "public" schema (matches the
          // existing DrizzlePushService PG path).
          pushSchema: (schema, db) => kit.pushSchema(schema, db, ["public"]),
        };
      }
      case "mysql": {
        if (!databaseName) {
          throw new Error(
            "PushSchemaPipeline: MySQL requires databaseName in apply() args. " +
              "Caller (e.g. dev-server.ts, dispatcher) must extract the database " +
              "name from the connection URL and pass it through. Empty/undefined " +
              "would silently no-op in drizzle-kit's MySQL pushSchema."
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

  // Returns a function that runs callback inside db.transaction.
  // Production: uses drizzle's tx API. Tests: overridden via _txOverride.
  private makeTransactionRunner(db: unknown): DbTransactionRunner {
    interface DbWithTransaction {
      transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
    }
    const dbTyped = db as DbWithTransaction;
    return fn => dbTyped.transaction(fn);
  }

  // Classifies an error caught from the apply() flow into one of the
  // F2 SchemaApplyErrorCode strings. Uses constructor identity (not
  // stack-string matching, which is brittle across bundlers / source
  // maps / production builds).
  //
  // Contract for the `code` field on the failure result:
  //   - PUSHSCHEMA_FAILED: drizzle-kit's pushSchema raised (introspection
  //     failed, snapshot mismatch, etc.). Connection-related root causes
  //     surface this way.
  //   - DDL_EXECUTION_FAILED: a SQL statement we generated failed at run
  //     time (constraint violation, syntax error, etc.).
  //   - INTERNAL_ERROR: anything else (programmer error in the pipeline,
  //     unexpected throw from a stub, etc.).
  //
  // Callers SHOULD use this code for diagnostics / telemetry / log
  // filtering. Branching control flow on it is OK but should be wrapped
  // in a string-literal match (the value space may grow in F4-F8).
  private classifyErrorCode(err: unknown): string {
    if (err instanceof PushSchemaError) return "PUSHSCHEMA_FAILED";
    if (err instanceof DdlExecutionError) return "DDL_EXECUTION_FAILED";
    return "INTERNAL_ERROR";
  }
}

// Export so consumers (and tests) can reference the constant directly.
export { MANAGED_TABLE_PREFIXES_REGEX, isManagedTable };
