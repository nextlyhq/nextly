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

import {
  countNulls as countNullsHelper,
  countRows as countRowsHelper,
} from "./classifier/count-helpers.js";
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
  MigrationJournalScope,
  MigrationJournalSummary,
  Notifier,
  PreCleanupExecutor,
  PreRenameExecutor,
  PromptDispatcher,
  RenameCandidate,
  RenameDetector,
} from "./pushschema-pipeline-interfaces.js";

import { buildNotificationEvent } from "../../../runtime/notifications/build-event.js";
import type { MigrationScope } from "../../../runtime/notifications/types.js";
import type { ClassifierEvent, Resolution } from "./resolution/types.js";
import type { DesiredSchema } from "./types.js";

// F5 PR 4: produces a copy of `desired` where any field targeted by a
// make_optional resolution has its `required` flag flipped to false (or
// removed) so the next pushSchema call sees the column as still-nullable
// and emits no SET NOT NULL. Pure function; never mutates `desired`.
//
// Note: we patch the field's `required` attribute, not nullable. nullable
// is the schema-level property; required is the field-config attribute
// that drives buildDesiredTableFromFields' nullable mapping.
function applyMakeOptionalToDesired(
  desired: DesiredSchema,
  resolutions: Resolution[],
  events: ClassifierEvent[]
): DesiredSchema {
  const makeOptionalEventIds = new Set(
    resolutions.filter(r => r.kind === "make_optional").map(r => r.eventId)
  );
  if (makeOptionalEventIds.size === 0) return desired;

  // Map eventId -> { table, column } for kinds that own a column.
  const targets = new Map<string, { table: string; column: string }>();
  for (const event of events) {
    if (
      makeOptionalEventIds.has(event.id) &&
      (event.kind === "add_not_null_with_nulls" ||
        event.kind === "add_required_field_no_default")
    ) {
      targets.set(event.id, {
        table: event.tableName,
        column: event.columnName,
      });
    }
  }
  if (targets.size === 0) return desired;

  const patchCollection = <
    T extends {
      tableName: string;
      fields: DesiredSchema["collections"][string]["fields"];
    },
  >(
    coll: T
  ): T => {
    const matchingTargets = [...targets.values()].filter(
      t => t.table === coll.tableName
    );
    if (matchingTargets.length === 0) return coll;
    return {
      ...coll,
      fields: coll.fields.map(field => {
        const matched = matchingTargets.some(t => t.column === field.name);
        if (!matched) return field;
        // Spread + override `required` to false. Drizzle/runtime treats
        // required:false as nullable column.
        return { ...field, required: false };
      }),
    };
  };

  return {
    ...desired,
    collections: Object.fromEntries(
      Object.entries(desired.collections).map(([slug, c]) => [
        slug,
        patchCollection(c),
      ])
    ),
    singles: Object.fromEntries(
      Object.entries(desired.singles).map(([slug, s]) => [
        slug,
        patchCollection(s),
      ])
    ),
    components: Object.fromEntries(
      Object.entries(desired.components).map(([slug, c]) => [
        slug,
        patchCollection(c),
      ])
    ),
  };
}

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
  // F5 PR 4: runs UPDATE/DELETE pre-cleanup or patches the desired snapshot
  // for make_optional. Slots between PreResolutionExecutor and pushSchema.
  preCleanupExecutor: PreCleanupExecutor;
  migrationJournal: MigrationJournal;
  // F10 PR 3: notification dispatcher fan-out. Pipeline calls
  // `notifier.notify(event)` after recordEnd in both success + failure
  // paths. Defaults to `noopNotifier` in tests; production wires
  // `createNotifier({channels: [TerminalChannel, NDJSONChannel]})`.
  notifier: Notifier;
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

// F10 PR 2: derive the per-change-kind counts from the pipeline's
// post-resolution operation list. The counts mirror what the admin
// NotificationCenter renders ("1 added, 1 renamed"), so we count the
// FINAL ops (after `applyResolutionsToOperations` has folded confirmed
// (drop_column, add_column) pairs into rename_column ops) — otherwise
// renames would double-count as one removed + one added.
//
// Op-kind mapping:
//   add_table, add_column                    -> added
//   drop_table, drop_column                  -> removed
//   rename_table, rename_column              -> renamed
//   change_column_*                          -> changed
//
// Pure helper. Test seam: exported.
export function computeJournalSummaryFromOperations(
  operations: ReadonlyArray<Operation>
): MigrationJournalSummary {
  let added = 0;
  let removed = 0;
  let renamed = 0;
  let changed = 0;
  for (const op of operations) {
    switch (op.type) {
      case "add_table":
      case "add_column":
        added++;
        break;
      case "drop_table":
      case "drop_column":
        removed++;
        break;
      case "rename_table":
      case "rename_column":
        renamed++;
        break;
      case "change_column_type":
      case "change_column_nullable":
      case "change_column_default":
        changed++;
        break;
      default: {
        // Exhaustive switch — TS infers `op` as `never` here. New op
        // kinds added to the union must update this map.
        const exhaustive: never = op;
        void exhaustive;
        break;
      }
    }
  }
  return { added, removed, renamed, changed };
}

// F10 PR 2: derive the journal scope from the apply source + the
// optional UI-target slug (forwarded by the admin Save dispatcher).
// HMR/code-first applies re-run the full managed-tables snapshot, so
// they're tagged as global. UI-first saves are scoped to the one
// collection slug being edited.
//
// Pure helper. Test seam: exported.
export function computeJournalScope(
  source: "ui" | "code",
  uiTargetSlug: string | undefined
): MigrationJournalScope {
  if (source === "ui" && uiTargetSlug) {
    return { kind: "collection", slug: uiTargetSlug };
  }
  return { kind: "global" };
}

// F10 PR 3: bridge the two near-identical scope shapes (the journal-
// interface scope persisted into the DB column vs the notifications-
// module scope passed to channels). Keeping them as distinct types
// at the boundary lets each concern evolve independently — e.g. a
// future "tenant" field on the notification scope shouldn't bleed
// into the journal column union.
function toNotificationScope(scope: MigrationJournalScope): MigrationScope {
  if (scope.kind === "fresh-push") return { kind: "fresh-push" };
  if (scope.kind === "global") {
    return scope.slug
      ? { kind: "global", slug: scope.slug }
      : { kind: "global" };
  }
  // collection | single — both require a slug per
  // MigrationJournalScope's contract (asserted at the type-system
  // level because slug is optional only for fresh-push/global).
  return scope.slug
    ? { kind: scope.kind, slug: scope.slug }
    : { kind: "global" };
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
    // F10 PR 2: forwarded by the admin Save dispatcher when source is
    // "ui" so the journal can record `scope: { kind: "collection",
    // slug: <user's collection> }`. HMR/code-first applies omit it
    // and get tagged as global.
    uiTargetSlug?: string;
  }): Promise<PipelineResult> {
    const { desired, db, dialect, source, promptChannel, databaseName } = args;
    const scope = computeJournalScope(source, args.uiTargetSlug);
    // F10 PR 3: track wall-clock for the notification event. The
    // journal already computes its own duration; we duplicate here so
    // the notification event surfaces duration even when the journal
    // write best-effort-fails. Cheap (one Date.now()).
    const startMs = Date.now();
    const journalId = await this.deps.migrationJournal.recordStart({
      source,
      statementsPlanned: 0,
      scope,
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

      // F5 PR 5: count callbacks bound to the live DB. RealClassifier uses
      // them to populate add_not_null_with_nulls events with the actual
      // NULL row count + table size; noopClassifier ignores them. The
      // orchestrator owns DB access here so the classifier itself stays
      // pure (DI surface).
      const classificationResult = await this.deps.classifier.classify({
        operations,
        drizzleWarnings: [],
        hasDataLoss: false,
        countNulls: (table, column) =>
          countNullsHelper(db, dialect, table, column),
        countRows: table => countRowsHelper(db, dialect, table),
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

      // F5 PR 4: patch desired.collections inline for make_optional
      // resolutions BEFORE building drizzleSchema, so pushSchema sees the
      // column as still-nullable and never emits SET NOT NULL. We patch
      // `desired` rather than the snapshot because drizzleSchema is built
      // from desired.collections; patching the snapshot only would have no
      // effect on the SQL pushSchema generates.
      const patchedDesired = applyMakeOptionalToDesired(
        desired,
        dispatchResult.resolutions,
        classificationResult.events
      );

      const resolvedOps = applyResolutionsToOperations(
        operations,
        toRenameResolutions(dispatchResult.confirmedRenames, candidates)
      );

      // Phase C+D: execute pre-resolution ops, then pushSchema for the rest.
      const drizzleSchema = this.testHooks._buildDrizzleSchemaOverride
        ? this.testHooks._buildDrizzleSchemaOverride(patchedDesired, dialect)
        : this.buildDrizzleSchema(patchedDesired, dialect);

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

        // Phase D' (F5 PR 4): pre-cleanup executor runs UPDATE/DELETE for
        // provide_default + delete_nonconforming resolutions. Snapshot
        // patching for make_optional was already applied above by patching
        // `desired` before drizzleSchema was built. Aggregate fields across
        // all collections so the executor can validate provide_default
        // values against field types.
        // FieldConfig.name is typed string|undefined (some field types like
        // row containers have no name); filter to only named fields, which
        // are the only ones the classifier could have emitted events for.
        // Aggregate symmetrically with applyMakeOptionalToDesired which
        // patches collections + singles + components — keeping the two in
        // sync so a future classifier-on-singles event has field metadata
        // to validate provide_default values against.
        const aggregatedFields: Array<{ name: string; type: string }> = [
          ...Object.values(desired.collections),
          ...Object.values(desired.singles),
          ...Object.values(desired.components),
        ].flatMap(c =>
          c.fields
            .filter(
              (f): f is typeof f & { name: string } =>
                typeof f.name === "string"
            )
            .map(f => ({ name: f.name, type: f.type }))
        );
        try {
          await this.deps.preCleanupExecutor.execute({
            tx,
            desiredSnapshot,
            resolutions: dispatchResult.resolutions,
            events: classificationResult.events,
            fields: aggregatedFields,
            dialect,
          });
        } catch (err) {
          // PromptCancelledError from abort is not a DDL failure — let it
          // propagate with its original type so the outer error mapper
          // classifies it as CONFIRMATION_DECLINED.
          if (err instanceof PromptCancelledError) throw err;
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

      // F10 PR 2: derive the per-change-kind summary from the
      // post-resolution ops so the journal row carries audit-friendly
      // counts ("1 added, 1 renamed") for the admin NotificationCenter.
      const summary = computeJournalSummaryFromOperations(resolvedOps);

      await this.deps.migrationJournal.recordEnd(journalId, {
        success: true,
        statementsExecuted,
        summary,
      });

      // F10 PR 3: fan out a success notification (terminal box +
      // NDJSON line, plus any future channels). `notify()` swallows
      // per-channel failures internally so this can never throw.
      await this.deps.notifier.notify(
        buildNotificationEvent({
          success: true,
          source,
          scope: toNotificationScope(scope),
          summary,
          durationMs: Date.now() - startMs,
          journalId,
        })
      );

      return {
        success: true,
        statementsExecuted,
        renamesApplied: dispatchResult.confirmedRenames.length,
      };
    } catch (err) {
      const code = this.classifyErrorCode(err);
      const message = err instanceof Error ? err.message : String(err);
      await this.deps.migrationJournal.recordEnd(journalId, {
        success: false,
        statementsExecuted: 0,
        error: err,
      });

      // F10 PR 3: fan out a failure notification with the typed error
      // code + message. summary is omitted because the failure may
      // have happened before the diff was computed.
      await this.deps.notifier.notify(
        buildNotificationEvent({
          success: false,
          source,
          scope: toNotificationScope(scope),
          durationMs: Date.now() - startMs,
          journalId,
          error: { code, message },
        })
      );
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
