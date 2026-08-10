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

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { dequal } from "dequal";

import { getDialectTablesForPush } from "../../../database/index";
import { NextlyError } from "../../../errors";
import {
  getCachedSnapshot,
  getLiveSnapshot,
  setCachedSnapshot,
} from "../../../init/schema-snapshot-cache";
import { buildNotificationEvent } from "../../../runtime/notifications/build-event";
import type { MigrationScope } from "../../../runtime/notifications/types";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { FieldGroupSchemaService } from "../../field-groups/services/field-group-schema-service";
import {
  chooseTypeColumns,
  resolveRegistryNameFromCatalog,
} from "../../field-groups/storage/resolve-storage-names";
import { generateRuntimeSchema } from "../services/runtime-schema-generator";
import { identifierCaseRules } from "../utils/resolve-catalog-name";

import {
  countNulls as countNullsHelper,
  countRows as countRowsHelper,
} from "./classifier/count-helpers";
import {
  canEmitWithoutDrizzleKit,
  emitDdl,
  withoutUnemittableIndexes,
} from "./ddl-emitter";
import {
  buildDesiredTableFromFields,
  buildDesiredTableFromComponentFields,
} from "./diff/build-from-fields";
import { diffSnapshots } from "./diff/diff";
import { introspectLiveSnapshot } from "./diff/introspect-live";
import type { Operation, NextlySchemaSnapshot } from "./diff/types";
import { describePrecondition } from "./errors";
// Index restore uses the all-dialect templates, not ddl-emitter/: that module
// is the PostgreSQL fast path and throws for the dialect this exists for.
import {
  excludeLockedTableStatements,
  filterUnsafeStatements,
  findUnexpectedDestructiveStatements,
  getDrizzleTableName,
  isDrizzleTable,
  stripKitDropsOfDeclaredIndexes,
} from "./filter-unsafe-statements";
import { indexRestoreStatements } from "./index-restore";
import { MANAGED_TABLE_PREFIXES_REGEX, isManagedTable } from "./managed-tables";
import { applyMakeOptionalToOperations } from "./pre-cleanup/snapshot-patch";
import { applyResolutionsToOperations } from "./pre-resolution/apply-resolutions";
import { executePreResolutionOps } from "./pre-resolution/executor";
import {
  PromptCancelledError,
  TTYRequiredError,
} from "./prompt-dispatcher/errors";
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
} from "./pushschema-pipeline-interfaces";
import { builtByFor } from "./registered-collections";
import type { ClassifierEvent, Resolution } from "./resolution/types";
import { withCapturedStdout } from "./stdout-capture";
import type { DesiredSchema } from "./types";

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
  // F10 PR 6: per-change-kind diff counts. Set on success only;
  // absent on failure (the failure may have happened before the diff
  // was even computed). Mirrors the same shape persisted to the
  // journal's summary_* columns and emitted in the notification event.
  summary?: MigrationJournalSummary;
}

// Shape of drizzle-kit v1's pushSchema return value (mirrors the wrapper's
// PushSchemaResult in database/drizzle-kit-lazy.ts). v1 removed the pre-v1
// hasDataLoss/warnings fields; destructive statements arrive INSIDE
// sqlStatements with empty hints — the guard below scans the statements.
interface PushSchemaPassResult {
  sqlStatements: string[];
  hints: Array<{ hint: string; statement?: string }>;
}

interface DrizzleKitLike {
  // The tablesFilter scopes PG's introspection to only the desired tables
  // (travels as v1's named `entitiesConfig.tables`). Without scoping — and
  // without the system-table injection in buildDrizzleSchema — drizzle-kit
  // compares the full live DB against a partial desired schema, pairs
  // "dropped" tables with added ones, and its v1 rename resolver throws
  // `Internal error: resolver(...) was called without a HintsHandler`
  // (verified on rc.4; the pre-v1 behavior was an unanswerable TTY prompt).
  // SQLite/MySQL payload entrypoints accept NO tables filter — for those the
  // injection + post-emission `filterUnsafeStatements` are the only defenses.
  pushSchema: (
    schema: Record<string, unknown>,
    db: unknown,
    tablesFilter?: string[]
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

// Orphan-DROP statement patterns the unsafe-statement filter scans for.
// Both forms accept an optional schema-qualifier and quote style; the
// captured group is the bare object name used for owner-table inference.
// Gated debug log for which route (`useFastPath`) the apply took. Operators
// set DEBUG_SCHEMA=1 to enable both this and drizzle-kit's chatter inside
// withCapturedStdout. The non-additive enumeration on the fallback path
// makes "why didn't the fast path trigger?" trivially answerable in support.
function logApplyRoute(useFastPath: boolean, ops: Operation[]): void {
  if (process.env.DEBUG_SCHEMA !== "1") return;
  if (useFastPath) {
    console.debug(
      `[nextly] schema apply: fast-path DDL emitter (${ops.length} op(s))`
    );
    return;
  }
  const nonAdditive = ops
    .filter(o => o.type !== "add_column" && o.type !== "add_table")
    .map(o => o.type);
  console.debug(
    `[nextly] schema apply: drizzle-kit fallback (${ops.length} op(s); ` +
      `non-additive: ${nonAdditive.length === 0 ? "<none>" : nonAdditive.join(",")})`
  );
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
  // Test seam: inject a pre-built resolvedOps array to bypass the diff +
  // resolution pipeline. Lets unit tests exercise the scope-reduction and
  // routing logic with hand-crafted op types (e.g. rename_table) that the
  // normal diff path cannot produce today.
  _resolvedOpsOverride?: Operation[];
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
      case "drop_index":
        removed++;
        break;
      case "add_index":
        added++;
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
  uiTargetSlug: string | undefined,
  // Defaulted to `collection` so the many existing UI callers that target one keep their scope
  // without restating it. A single or field group must say so: recording either as a collection
  // hid its migrations from every scope-filtered audit query.
  uiTargetKind: "collection" | "single" | "component" = "collection"
): MigrationJournalScope {
  if (source === "ui" && uiTargetSlug) {
    return { kind: uiTargetKind, slug: uiTargetSlug };
  }
  return { kind: "global" };
}

// Table names owned by code-first config or a plugin (locked in the registry).
//
// Pure helper. Test seam: exported.
export function lockedTableNames(desired: DesiredSchema): Set<string> {
  const names = new Set<string>();
  for (const entity of [
    ...Object.values(desired.collections),
    ...Object.values(desired.singles),
    ...Object.values(desired.components),
  ]) {
    if (entity.locked && entity.tableName) names.add(entity.tableName);
  }
  return names;
}

// The table an operation targets, or null when it targets none. A rename is
// judged by its source name — that is the table that already exists and whose
// ownership therefore decides whether the rename is allowed.
//
// Pure helper. Test seam: exported.
export function operationTargetTable(op: Operation): string | null {
  switch (op.type) {
    case "add_table":
      return op.table.name;
    case "drop_table":
      return op.tableName;
    case "rename_table":
      return op.fromName;
    case "add_column":
    case "drop_column":
    case "rename_column":
    case "change_column_type":
    case "change_column_nullable":
    case "change_column_default":
    case "add_index":
    case "drop_index":
      return op.tableName;
    default: {
      // Exhaustiveness check: a new Operation kind must be classified here.
      const _exhaustive: never = op;
      void _exhaustive;
      return null;
    }
  }
}

// A Schema Builder (UI) save must only change the entity being edited. Any
// operation targeting a table owned by code-first config or a plugin is
// dropped: those tables belong to `nextly.config.ts` and its migrations, and
// reconciling their drift is db:sync's job. Without this, saving one UI
// collection could silently ALTER (or drop) an unrelated code-first table that
// merely disagreed with the live database.
//
// Pure helper. Test seam: exported.
export function excludeLockedTableOps(
  ops: Operation[],
  desired: DesiredSchema
): { kept: Operation[]; skipped: Operation[] } {
  const locked = lockedTableNames(desired);
  if (locked.size === 0) return { kept: ops, skipped: [] };

  const kept: Operation[] = [];
  const skipped: Operation[] = [];
  for (const op of ops) {
    const table = operationTargetTable(op);
    if (table !== null && locked.has(table)) skipped.push(op);
    else kept.push(op);
  }
  return { kept, skipped };
}

export function logSkippedLockedOps(skipped: Operation[]): void {
  if (skipped.length === 0 || process.env.DEBUG_SCHEMA !== "1") return;
  const tables = [
    ...new Set(skipped.map(op => operationTargetTable(op) ?? "<unknown>")),
  ];
  console.debug(
    `[nextly] schema apply: skipped ${skipped.length} op(s) on code-first ` +
      `table(s) not owned by this UI save: ${tables.join(", ")}`
  );
}

function logSkippedLockedStatements(skipped: string[]): void {
  if (skipped.length === 0 || process.env.DEBUG_SCHEMA !== "1") return;
  console.debug(
    `[nextly] schema apply: dropped ${skipped.length} emitted statement(s) ` +
      `targeting code-first table(s) not owned by this UI save: ` +
      skipped.join("; ")
  );
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
  // collection | single | component — the scope type requires a slug on each of them, so there is
  // no slugless case left to fall back for. The fallback this replaces silently retargeted such a
  // scope to the whole schema, which is the one outcome an entity-scoped apply must not produce.
  return { kind: scope.kind, slug: scope.slug };
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
    /** Which entity kind `uiTargetSlug` names, so the journal row records it accurately. */
    uiTargetKind?: "collection" | "single" | "component";
  }): Promise<PipelineResult> {
    const { db, dialect, source, promptChannel, databaseName } = args;
    // Resolved once, before anything reads it. A desired schema is consumed by TWO builders — the
    // snapshot the diff compares and the Drizzle tables drizzle-kit turns into DDL — and resolving
    // inside either leaves the other on the raw fields, so a table would converge and then report a
    // type change against itself on every following diff.
    const desired = args.desired;
    const scope = computeJournalScope(
      source,
      args.uiTargetSlug,
      args.uiTargetKind
    );
    // F10 PR 3: track wall-clock for the notification event. The
    // journal already computes its own duration; we duplicate here so
    // the notification event surfaces duration even when the journal
    // write best-effort-fails. Cheap (one Date.now()).
    const startMs = Date.now();

    // Phase 5 (2026-05-01) — dequal short-circuit.
    //
    // If the desired-schema snapshot is byte-for-byte equal to the last
    // successfully-applied one, skip the entire pipeline. Avoids the
    // work + TTY exposure of re-introspecting + re-diffing when nothing
    // changed. Particularly valuable on Next.js HMR where any
    // server-side file save triggers `serverComponentChanges` (not just
    // nextly.config.ts), which previously made the pipeline run on
    // every route-handler save.
    //
    // Cache key: the entire `desired` object. dequal walks deeply, so
    // any nested change (a new field, a renamed table, a tweaked
    // required flag) bypasses the short-circuit. Cosmetic-only
    // properties (admin-display labels, hooks, etc.) WOULD also bypass
    // — accepted false-positive cost vs. risking a missed real change.
    //
    // Skipping recordStart means no-op cycles don't pollute the
    // migration journal. The successful PipelineResult below mimics
    // the full-success shape with statementsExecuted=0.
    //
    // Reference: Payload's pushDevSchema pattern in
    // packages/drizzle/src/utilities/pushDevSchema.ts.
    const cachedSnapshot = getCachedSnapshot();
    if (cachedSnapshot !== undefined && dequal(desired, cachedSnapshot)) {
      console.log(
        "[Nextly schema] No changes detected since last apply; skipping push (dequal cache hit)."
      );
      return {
        success: true,
        statementsExecuted: 0,
        renamesApplied: 0,
        // Zero-count summary — same shape as the full-success branch,
        // so the dispatcher's notification rendering doesn't have to
        // distinguish "no-op" from "real-success-with-no-ops".
        summary: {
          added: 0,
          removed: 0,
          renamed: 0,
          changed: 0,
        },
      };
    }

    // Phase 5: pass `batch: -1` for HMR/dev pushes so audit queries
    // can filter them out (`WHERE batch >= 0` shows production
    // migrations only). UI-driven pushes count as "intentional"
    // changes a user committed via the admin and don't need the
    // sentinel; they default to 0.
    const journalId = await this.deps.migrationJournal.recordStart({
      source,
      statementsPlanned: 0,
      scope,
      batch: source === "code" ? -1 : undefined,
    });

    try {
      const managedTableNames = [
        ...Object.values(desired.collections).map(c => c.tableName),
        ...Object.values(desired.singles).map(s => s.tableName),
        ...Object.values(desired.components).map(c => c.tableName),
      ];

      // Phase A: our diff. Reuse the cached live snapshot when the outer
      // caller (reload-config.ts) already introspected the exact same
      // managed-table set within this apply boundary. We do NOT self-fill
      // the cache on a miss: the Builder UI apply path never calls
      // clearLiveSnapshots(), so a self-fill here would cause subsequent
      // Builder applies to serve stale snapshots. The cache exists only
      // to dedupe the reload-config → pipeline.apply call chain.
      let liveSnapshot: NextlySchemaSnapshot;
      if (this.testHooks._introspectSnapshotOverride) {
        liveSnapshot = await this.testHooks._introspectSnapshotOverride(
          db,
          dialect,
          managedTableNames
        );
      } else {
        const cached = getLiveSnapshot(managedTableNames);
        liveSnapshot =
          cached !== undefined
            ? (cached as NextlySchemaSnapshot)
            : await introspectLiveSnapshot(db, dialect, managedTableNames);
      }

      // 🔴 Derived from the snapshot just taken, not from a fresh catalog read.
      //
      // That snapshot was introspected over exactly these table names, so it
      // already carries the columns this needs — and deriving from it guarantees
      // the desired shape and the live shape are read from ONE observation of
      // the database. A second read could disagree with the first, and a diff
      // computed across two disagreeing observations is the one thing this
      // function must never produce.
      // 🔴 Contained, and its failure means "declare NEITHER registry".
      //
      // The desired schema is what drizzle-kit creates from, so naming the
      // wrong registry creates an empty one — and on MySQL and SQLite the full
      // schema is always handed over, because scope reduction below is
      // PostgreSQL-only. Guessing is therefore the one thing this must not do.
      // Omitting it instead leaves drizzle-kit free to propose a DROP, which
      // `filterUnsafeStatements` blocks and reports; a wrong CREATE is additive
      // and nothing stops it.
      const fieldGroupRegistryTable = await resolveRegistryNameFromCatalog({
        dialect,
        getDrizzle: <T>() => db as T,
      }).catch(() => undefined);

      const fieldGroupTypeColumns = chooseTypeColumns(
        liveSnapshot.tables.map(table => ({
          table: table.name,
          columns: table.columns.map(column => column.name),
        })),
        Object.values(desired.components).map(c => c.tableName),
        // MySQL is given the folding setting rather than queried for it. The
        // names being matched are ones this apply itself asked the server to
        // describe, so a case-insensitive table match cannot select a different
        // object than the one requested — while an exact match would miss a
        // server that reported it folded. Column names fold on MySQL
        // regardless, which is what the discriminator lookup actually needs.
        dialect === "mysql"
          ? identifierCaseRules({ dialect, lowerCaseTableNames: 1 })
          : identifierCaseRules({ dialect })
      );

      const desiredSnapshot: NextlySchemaSnapshot = {
        tables: [
          ...Object.values(desired.collections).map(c =>
            buildDesiredTableFromFields(
              c.tableName,
              // FieldConfig has the shape buildDesiredTableFromFields expects;
              // cast through unknown for the structural-vs-nominal type gap.
              c.fields as unknown as Parameters<
                typeof buildDesiredTableFromFields
              >[1],
              dialect,
              // Thread the status flag so the diff includes the status system
              // column when Draft/Published is enabled. Thread `localized` so a
              // localized collection's translatable columns are omitted from the
              // main table's desired snapshot (they live in the companion
              // `_locales` table) rather than being re-added by the diff.
              {
                builtBy: builtByFor("collection", c.builderOwned),
                hasStatus: c.status === true,
                localized: c.localized === true,
              }
            )
          ),
          ...Object.values(desired.singles).map(s =>
            buildDesiredTableFromFields(
              s.tableName,
              s.fields as unknown as Parameters<
                typeof buildDesiredTableFromFields
              >[1],
              dialect,
              {
                builtBy: builtByFor("single", s.builderOwned),
                hasStatus: s.status === true,
                localized: (s as { localized?: boolean }).localized === true,
              }
            )
          ),
          ...Object.values(desired.components).map(c =>
            buildDesiredTableFromComponentFields(
              c.tableName,
              c.fields as unknown as Parameters<
                typeof buildDesiredTableFromComponentFields
              >[1],
              dialect,
              {
                builtBy: builtByFor("fieldGroup", c.builderOwned),
                localized: (c as { localized?: boolean }).localized === true,
                typeColumn: fieldGroupTypeColumns.get(c.tableName),
              }
            )
          ),
        ],
      };

      const allOperations = diffSnapshots(liveSnapshot, desiredSnapshot);

      // A UI save owns only the entity being edited. An operation targeting a code-first or
      // plugin-owned table is dropped here, BEFORE anything reads the operation set, because those
      // tables belong to `nextly.config.ts` and reconciling their drift is db:sync's job.
      //
      // 🔴 Dropped before rename detection rather than after prompting, which is where this used to
      // happen. An operation on a locked table still reached the rename detector and the prompt gate
      // on the way, and an unresolved candidate fails closed — so unapplied drift on a table the
      // save was never going to touch could refuse the entire save, over an operation the very next
      // step discards. Code-first applies keep the full set: they ARE the authority for those tables.
      const { kept: operations, skipped: skippedLockedOps } =
        source === "ui"
          ? excludeLockedTableOps(allOperations, desired)
          : { kept: allOperations, skipped: [] as Operation[] };
      logSkippedLockedOps(skippedLockedOps);

      // Phase B: rename detection + prompt + resolution application.
      const candidates = this.deps.renameDetector.detect(operations, dialect);

      // F5 PR 5: count callbacks bound to the live DB. RealClassifier uses
      // them to populate add_not_null_with_nulls events with the actual
      // NULL row count + table size; noopClassifier ignores them. The
      // orchestrator owns DB access here so the classifier itself stays
      // pure (DI surface).
      const classificationResult = await this.deps.classifier.classify({
        operations,
        countNulls: (table, column) =>
          countNullsHelper(db, dialect, table, column),
        countRows: table => countRowsHelper(db, dialect, table),
        dialect,
      });

      // Drops that have a rename candidate are resolved by the
      // dispatcher's shrinking-pool prompt — its "drop_and_add" option
      // already implies user consent to data loss. Filter their
      // destructive_drop events here so the user isn't asked the same
      // question twice (once for the rename pair, once for the drop).
      const dropsCoveredByCandidates = new Set<string>();
      for (const c of candidates) {
        dropsCoveredByCandidates.add(`${c.tableName}::${c.fromColumn}`);
      }
      const dispatchEvents = classificationResult.events.filter(
        e =>
          e.kind !== "destructive_drop" ||
          !dropsCoveredByCandidates.has(`${e.tableName}::${e.columnName}`)
      );

      const needsPrompt = candidates.length > 0 || dispatchEvents.length > 0;
      const dispatchResult = needsPrompt
        ? await this.deps.promptDispatcher.dispatch({
            candidates,
            events: dispatchEvents,
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

      const renameResolvedOps =
        this.testHooks._resolvedOpsOverride ??
        applyResolutionsToOperations(
          operations,
          toRenameResolutions(dispatchResult.confirmedRenames, candidates)
        );
      // make_optional must reach the OPERATIONS too, not only `desired`: the
      // fast-path emitters (and the kit-path table pre-creation) generate
      // their SQL from these ops, so an unpatched add_column would still say
      // NOT NULL despite the admin's resolution — failing the apply on a
      // populated table or landing the column as required.
      const allResolvedOps = applyMakeOptionalToOperations(
        renameResolvedOps,
        dispatchResult.resolutions,
        classificationResult.events
      );

      // Already excluded above, before the operation set was read. Resolutions are keyed to the
      // candidates and events that set produced, so none of them can reintroduce a locked table.
      const resolvedOps = allResolvedOps;

      // Phase C+D: execute pre-resolution ops, then pushSchema for the rest.
      const drizzleSchema = this.testHooks._buildDrizzleSchemaOverride
        ? this.testHooks._buildDrizzleSchemaOverride(patchedDesired, dialect)
        : this.buildDrizzleSchema(
            patchedDesired,
            dialect,
            fieldGroupTypeColumns,
            fieldGroupRegistryTable
          );

      // Scope drizzleSchema down to the table(s) actually touched by
      // resolvedOps. Without this, a Builder save that touches one
      // collection still forces drizzle-kit to introspect every managed
      // table inside the pinned transaction (~14 pg_catalog queries per
      // table per call, which dominates wall-time on a high-RTT pooled
      // connection like Neon).
      //
      // Single-table assumption: we don't walk FK closure today because
      // Builder operations are effectively single-table — if a future
      // change ever crosses managed-table FKs the safety net below falls
      // back to the full schema and drizzle-kit will resolve as before.
      const affectedTableNames = new Set<string>();
      for (const op of resolvedOps) {
        switch (op.type) {
          case "add_table":
            affectedTableNames.add(op.table.name);
            break;
          case "rename_table":
            // After pre-resolution the live DB and desired snapshot both
            // carry the new name — scope by `toName`.
            affectedTableNames.add(op.toName);
            break;
          case "drop_table":
            // Already applied by pre-resolution; not in drizzleSchema.
            break;
          case "add_column":
          case "drop_column":
          case "rename_column":
          case "change_column_type":
          case "change_column_nullable":
          case "change_column_default":
          case "add_index":
          case "drop_index":
            affectedTableNames.add(op.tableName);
            break;
          default: {
            // Exhaustiveness check: adding a new Operation kind without
            // handling it here is a compile-time error. The empty-schema
            // safety net below catches the runtime fallthrough case.
            const _exhaustive: never = op;
            void _exhaustive;
          }
        }
      }

      // Scope-reduction is PostgreSQL-only. drizzle-kit honours
      // `tablesFilter` on PG so its catalog introspection is limited to
      // the affected tables, which is where the perf win comes from. On
      // SQLite/MySQL drizzle-kit ignores `tablesFilter` and walks the
      // full live DB; handing it a scoped schema makes it flag every
      // un-scoped system table (users, roles, accounts, sessions, ...)
      // as a drop and fire its rename-detection TUI, crashing non-TTY
      // boots. The long-term direction (see DrizzleKitLike comment) is
      // `generateMigration(prev, cur)` which would let us drop this
      // gating entirely.
      const scopedSchema: Record<string, unknown> = {};
      for (const [tableName, tableObj] of Object.entries(drizzleSchema)) {
        if (affectedTableNames.has(tableName)) {
          scopedSchema[tableName] = tableObj;
        }
      }
      const effectiveDrizzleSchema =
        dialect === "postgresql" && Object.keys(scopedSchema).length > 0
          ? scopedSchema
          : drizzleSchema;

      // Deferred until the route decision needs it: importing eagerly made
      // MySQL fail its databaseName precondition even for applies that never
      // reach drizzle-kit (empty or purely-additive op sets on an adapter
      // wired without a parseable DATABASE_URL).
      const getKit = async (): Promise<DrizzleKitLike> =>
        this.testHooks._kitOverride
          ? this.testHooks._kitOverride
          : this.importDrizzleKit(dialect, databaseName);

      const isSqlite = dialect === "sqlite";

      const runApply = async (tx: unknown): Promise<number> => {
        // Phase C: pre-resolution executor runs renames + drops.
        const preResExecutor =
          this.testHooks._executePreResolutionOverride ??
          executePreResolutionOps;
        try {
          await preResExecutor(tx, resolvedOps, dialect);
        } catch (err) {
          // A refusal is not a failed statement. The pre-resolution phase can decline to start —
          // when the stored values would not survive a conversion, for instance — and that answer
          // carries the column, the reason and what to do about it. Wrapping it as a DDL failure
          // replaces all of that with a generic message about a statement that never ran.
          if (NextlyError.isValidation(err)) throw err;
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
        // applied INSIDE this transaction. On PostgreSQL we pass `tx` (not
        // the outer `db`) so drizzle-kit's introspection runs within the
        // same transaction and SEES the uncommitted pre-resolution changes.
        // Without this, drizzle-kit's introspection would still see the
        // old DROP+ADD ambiguity and fire its TTY prompt.
        //
        // SQLite skips db.transaction() per F3 PR-4, so `tx === db` for
        // SQLite (it's the same handle).
        //
        // MySQL must receive the OUTER db: the v1 kit derives its raw
        // client from `db.$client`, which only exists on the top-level
        // drizzle instance — MySql2Transaction objects have no $client, so
        // passing `tx` crashes the shim. That is semantically safe because
        // MySQL DDL auto-commits: the pre-resolution statements are already
        // visible to any connection by the time Phase D introspects.
        //
        // Phase C (2026-05-01): pass desired-table names to PG drizzle-kit
        // as `tablesFilter` so its introspection is scoped to just our
        // managed tables. SQLite/MySQL discard this; their data-loss
        // safety relies entirely on `filterUnsafeStatements` below.
        //
        const desiredTableNames = Object.keys(effectiveDrizzleSchema);

        // Route: fast in-memory DDL emission for the common Builder op set
        // on PostgreSQL (skips drizzle-kit's ~10s catalog re-introspection),
        // or fall back to drizzle-kit's pushSchema for anything outside
        // that set. Stations 1-7 (diff, rename detect, classifier, prompt,
        // pre-resolution) are upstream and unaffected either way;
        // filterUnsafeStatements still runs on the result.
        const useFastPath = canEmitWithoutDrizzleKit(resolvedOps, dialect);
        logApplyRoute(useFastPath, resolvedOps);

        let emittedStatements: string[];
        let pushResult: PushSchemaPassResult | undefined;
        // Statements this apply executed BEFORE drizzle-kit ran (kit-path
        // add_table pre-creation below) — counted into the journal's
        // executed total alongside the post-filter batch.
        let preCreatedStatements = 0;
        if (useFastPath) {
          emittedStatements = emitDdl(resolvedOps, dialect);
        } else {
          // Resolved BEFORE the pre-creation below writes anything. The
          // import carries MySQL's `databaseName` precondition, and running
          // it after the CREATEs would leave those tables behind on a
          // dialect whose DDL auto-commits when the precondition then
          // fails. The fast path never reaches this branch, so a kit-free
          // apply still never evaluates the precondition at all.
          const kit = await getKit();

          // v1 kit crash guard (SQLite/MySQL only — PG scopes the kit's
          // introspection with a tables filter): drizzle-kit v1's differ
          // sees the WHOLE live DB on these dialects, so any live table
          // absent from the desired schema (UI-created entities during a
          // code-first apply, `_locales` companions, the i18n archive)
          // reads as "deleted". Paired against a "created" table from this
          // apply, its rename resolver throws `Internal error:
          // resolver(table) was called without a HintsHandler` before
          // emitting anything, failing the apply and leaving the new table
          // uncreated. Creating the planned tables OURSELVES first empties
          // the differ's created set — nothing to pair, no resolver call —
          // and the kit then handles only the column-level remainder (it
          // re-introspects and sees these tables live AND declared).
          //
          // On SQLite these CREATEs are not rolled back when the kit pass
          // then fails: the pipeline runs SQLite outside `db.transaction()`
          // by design, so `tx === db` here. That is the intended outcome
          // rather than a gap — the retry's diff re-introspects, no longer
          // plans `add_table` for them, and the table it finds is the one
          // this emitter built, which carries the tracked indexes the kit's
          // own CREATE would have omitted. The journal records the failed
          // apply without these statements in `statements_executed`, which
          // counts only a successful pass.
          if (dialect !== "postgresql") {
            const addTableOps = resolvedOps.filter(
              op => op.type === "add_table"
            );
            if (addTableOps.length > 0) {
              // This branch runs for tables the routing decision may have
              // REJECTED, so it cannot emit them verbatim: a MySQL UNIQUE
              // index over a TEXT/BLOB column is exactly what sent such an
              // apply here, and emitting it would reinstate the prefix
              // uniqueness that decision existed to avoid. The table body is
              // still pre-created (that is the crash guard); drizzle-kit adds
              // the stripped index from its own introspection.
              const createStatements = emitDdl(
                addTableOps.map(op => withoutUnemittableIndexes(op, dialect)),
                dialect
              );
              try {
                await this.deps.executor.executeStatements(
                  tx,
                  createStatements
                );
              } catch (err) {
                throw new DdlExecutionError(
                  err instanceof Error ? err.message : String(err),
                  err
                );
              }
              preCreatedStatements = createStatements.length;
            }
          }
          try {
            // withCapturedStdout reroutes any chatter drizzle-kit writes to
            // process.stdout/stderr so it doesn't leak into the dev console.
            // The sink only forwards when DEBUG_SCHEMA=1 — see
            // stdout-capture.ts for the scope-caveat (sync-return path).
            //
            // v1 note: if the kit's differ manufactures a drop+add rename
            // ambiguity (partial schema, scope mismatch), its resolver throws
            // `Internal error: resolver(...) without a HintsHandler` — the
            // catch below converts that into a journaled PushSchemaError
            // instead of the pre-v1 unanswerable TTY prompt.
            pushResult = await withCapturedStdout(
              () =>
                kit.pushSchema(
                  effectiveDrizzleSchema,
                  dialect === "mysql" ? db : tx,
                  desiredTableNames
                ),
              process.env.DEBUG_SCHEMA === "1"
                ? { debug: (msg: string) => console.debug(msg) }
                : undefined
            );
          } catch (err) {
            throw new PushSchemaError(
              err instanceof Error ? err.message : String(err),
              err
            );
          }
          // The kit reads every live index on a declared table as
          // undeclared (its runtime schemas carry none) and emits DROP
          // INDEX for it even on a no-op. An index the desired snapshot
          // TRACKS is only ever dropped by our own diff's drop_index op,
          // so the kit's drops of tracked indexes are stripped here —
          // otherwise a kit-path apply would shed the canonical indexes
          // of every managed table it did not rebuild.
          const stripped = stripKitDropsOfDeclaredIndexes(
            pushResult.sqlStatements,
            desiredSnapshot
          );
          emittedStatements = stripped.kept;
          if (stripped.strippedCount > 0) {
            // Once per apply, not per statement: enough to see the guard
            // acted without turning a routine emission into log noise.
            console.debug(
              `[Nextly schema] Kept ${stripped.strippedCount} tracked index(es) ` +
                `drizzle-kit emitted a DROP INDEX for (they are declared in the ` +
                `desired schema; only a drop_index operation removes one).`
            );
          }
        }
        // Safety net, v1 semantics (observed on all three dialects,
        // 2026-07): drizzle-kit now INCLUDES destructive statements in
        // sqlStatements with EMPTY hints — the pre-v1 "omit + warn"
        // contract is gone (that omission caused three false-success
        // applies on a live site: rext-site-v2 / `dc_case_studies`,
        // May 2026). Every user-approved destructive op has already run
        // in the pre-resolution phase, so anything destructive emitted
        // here means the emitter disagrees with our differ — never
        // execute it; fail the apply so the journal records failure.
        //
        // Properties of this scan:
        //   - It runs on BOTH routes (fast path and kit path), so the
        //     guarantee never depends on FAST_PATH_OP_TYPES staying
        //     drop-free forever.
        //   - It scans the RAW kit output (`emittedStatements`) BEFORE
        //     filterUnsafeStatements, restricted to MANAGED tables (the
        //     desired schema). Scanning the post-filter remainder would make
        //     the guarantee depend on the filter having correctly stripped
        //     every orphan drop first; a filter bug that mis-classified a
        //     managed-table drop as an orphan would then hide it from the
        //     scan. Identifying orphans here by table membership instead —
        //     drops of tables outside the desired schema are the EXPECTED
        //     emission the filter handles separately — keeps the
        //     destructive-on-managed guard independent of the filter. `safe`
        //     is still what actually executes.
        //   - On a UI save, locked tables are removed from the managed set
        //     rather than the scan being moved after the lock filter. Keeping
        //     the scan on the raw output preserves the independence above; the
        //     narrowing is sound because a locked table's statements are
        //     dropped unconditionally and can never execute, so this apply is
        //     not the thing that would be destroying them.
        // Rebuild blocks are only trusted for tables where OUR diff
        // approved a rebuild-justifying change — a rebuild on any other
        // table is the kit encoding a column drop we never approved
        // (rc.4 emits exactly that shape; probe-verified).
        const allowedRebuildTables = new Set(
          resolvedOps
            .filter(
              op =>
                op.type === "change_column_type" ||
                op.type === "change_column_nullable" ||
                op.type === "change_column_default"
            )
            .map(op => op.tableName.toLowerCase())
        );
        // Tables this apply is answerable for. On a UI save the locked ones are
        // excluded: their statements are dropped below and never execute, so
        // holding the apply to account for destructive DDL on them would let
        // pre-existing drift in a code-first table block saving an unrelated
        // builder-owned entity. Everything still executed stays in scope.
        const lockedForThisApply =
          source === "ui" ? lockedTableNames(desired) : new Set<string>();
        const managedTables = new Set(
          desiredTableNames
            .map(t => t.toLowerCase())
            .filter(t => !lockedForThisApply.has(t))
        );
        // Only drizzle-kit's output goes through the orphan filter. That
        // filter answers "did the kit propose dropping something we never
        // asked about?", and it identifies an index's owner from the
        // suffix-style names the kit produces (`<table>_<col>_idx`). Nextly's
        // own indexes are named `idx_<table>_<col>` / `uq_<table>_<col>`, for
        // which that inference finds no owner and the drop is blocked — so
        // running it over the fast path's statements would silently discard a
        // `drop_index` this pipeline's own diff planned and the apply would
        // report success with the index still in place. Fast-path SQL is
        // emitted from those approved operations, so there is no orphan to
        // find; the destructive scan and the lock filter below still apply to
        // both routes.
        const unlocked = useFastPath
          ? emittedStatements
          : filterUnsafeStatements(emittedStatements, desiredTableNames);
        // Op-level lock filtering covers what this pipeline decided to do, but
        // drizzle-kit re-derives drift from the full desired schema, so on the
        // kit path it can still emit DDL for a locked table. Scope reduction
        // only narrows that on PostgreSQL — SQLite and MySQL ignore
        // tablesFilter entirely — so the guarantee is enforced here, on the
        // statements themselves, where it holds for every dialect.
        const { kept: safe, skipped: skippedLockedStatements } =
          excludeLockedTableStatements(unlocked, lockedForThisApply);
        logSkippedLockedStatements(skippedLockedStatements);
        const unexpectedDestructive = findUnexpectedDestructiveStatements(
          emittedStatements,
          allowedRebuildTables,
          managedTables
        );
        if (unexpectedDestructive.length > 0) {
          throw new PushSchemaError(
            `schema emitter produced ${unexpectedDestructive.length} ` +
              `destructive statement(s) on the purely-additive ` +
              `remainder. The schema was NOT applied. Statements: ` +
              unexpectedDestructive.join("; ")
          );
        }

        if (pushResult) {
          // Secondary tripwire: hints were empty in every observed rc.4
          // scenario. If one ever appears here, the kit's semantics
          // changed underneath us — fail loudly rather than ignore an
          // uninterpreted signal.
          if (pushResult.hints.length > 0) {
            throw new PushSchemaError(
              `drizzle-kit returned ${pushResult.hints.length} hint(s) on ` +
                `the purely-additive remainder — uninterpreted signal, ` +
                `refusing to apply: ` +
                pushResult.hints
                  .map(h => h.hint + (h.statement ? ` [${h.statement}]` : ""))
                  .join("; ")
            );
          }
        }

        // Appended to the same batch so they run after the table changes they
        // index. On PG and MySQL that batch is transactional; SQLite runs
        // without a transaction by design, so a failing restore there is
        // reported but the rebuild it followed has already landed.
        //
        // The ops are handed over ONLY on the kit route: the restore's
        // ops-replay exists because drizzle-kit never creates dynamic-table
        // indexes, but the fast path emits every add_index itself, so
        // replaying them would issue the same CREATE INDEX twice — fatal on
        // MySQL, which has no IF NOT EXISTS for indexes.
        const restore = indexRestoreStatements(
          desiredSnapshot,
          dialect,
          safe,
          useFastPath ? [] : resolvedOps
        );

        try {
          await this.deps.executor.executeStatements(tx, [...safe, ...restore]);
        } catch (err) {
          throw new DdlExecutionError(
            err instanceof Error ? err.message : String(err),
            err
          );
        }

        // `safe.length` plus the kit-path pre-created statements, not the
        // executed length: this number is the journal's
        // `statements_executed`, read against `statements_planned` from the
        // diff. The restore statements were never planned, so counting them
        // would report a mismatch on every apply that had to put an index
        // back; the pre-created CREATEs WERE planned (add_table ops) and
        // executed, so they count.
        return safe.length + preCreatedStatements;
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

      // Phase 5: cache the desired snapshot now that the apply succeeded.
      // Future apply() calls with an unchanged desired short-circuit at
      // the top of this method. We only set the cache on the success
      // path — failed applies leave the cache untouched so the next
      // call retries the full pipeline.
      setCachedSnapshot(desired);

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
        // F10 PR 6: surface the diff counts so the dispatcher can
        // render an admin toast like "1 field added, 1 renamed".
        summary,
      };
    } catch (err) {
      const code = this.classifyErrorCode(err);
      // A refused precondition carries its subject in the payload, not in the message: the
      // validation factory sets a deliberately generic public message. Reading `err.message` here
      // would report the correct CODE with no indication of which column, which is the half of the
      // answer the operator cannot act on. Presentation comes from the shared describer so this
      // result and `classifyError`'s cannot drift.
      const described = NextlyError.isValidation(err)
        ? describePrecondition(err)
        : undefined;
      const message =
        described?.message ??
        (err instanceof Error ? err.message : String(err));
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
          message,
          details: described ? described.details : err,
        },
      };
    }
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
    dialect: SupportedDialect,
    typeColumns: Map<string, string>,
    fieldGroupRegistryTable: string | undefined
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    // Phase 6 follow-up (2026-05-01): include Nextly's system tables in
    // the schema handed to drizzle-kit. Without this, drizzle-kit's
    // introspection sees system tables on disk but NOT in the desired
    // schema we pass — its diff treats those as "dropped tables" and
    // pairs them with new dc_* tables for rename detection. Rename
    // detection fires the TTY prompt, which crashes on non-TTY
    // environments (CI, `next dev`'s server thread). Result:
    // dc_* tables never get created on SQLite.
    //
    // SQLite's drizzle-kit doesn't accept tablesFilter (only PG does),
    // so the only way to suppress false-positive rename ambiguity is
    // to make the desired schema complete from drizzle-kit's POV.
    // System tables are already managed via drizzle-kit migration
    // files (database/migrations/<dialect>/*.sql); declaring them here
    // is informational — drizzle-kit emits zero statements for them
    // when disk matches the schema definition. Phase C's strict
    // filterUnsafeStatements is the safety net.
    for (const [exportKey, value] of Object.entries(
      // `null` where the catalog could not say which registry exists, which the
      // bundle reads as "declare neither".
      getDialectTablesForPush(dialect, {
        fieldGroupRegistryTable: fieldGroupRegistryTable ?? null,
      })
    )) {
      if (isDrizzleTable(value)) {
        const sqlName = getDrizzleTableName(value, exportKey);
        out[sqlName] = value;
      }
    }

    // User-defined collections override system entries on conflict.
    for (const c of Object.values(desired.collections)) {
      // Why: forward the Draft/Published flag so drizzle-kit's view of the
      // desired schema includes the system status column. Without this,
      // drizzle-kit's diff against live DB drops the status column from
      // its DDL — even though the Nextly diff path above (line ~458) had
      // already classified the add as safe. The two paths must agree on
      // table shape; they share the same `desired.collections` input but
      // had different defaults for the status flag.
      // i18n: forward `localized` too. This is the DDL-generating schema handed
      // to drizzle-kit's pushSchema — without the flag, drizzle-kit's main table
      // still carries the translatable columns and pushSchema ADDs them to the
      // main table, even though the snapshot diff (buildDesiredTableFromFields,
      // used only for rename detection) already omits them. Both views must agree
      // or a localized collection's translatable columns leak onto main. The
      // companion `_locales` table is provisioned out-of-band.
      const { table } = generateRuntimeSchema(
        c.tableName,
        c.fields as unknown as Parameters<typeof generateRuntimeSchema>[1],
        dialect,
        {
          // This schema is what drizzle-kit renders as DDL, so the width rule matters here and the
          // builder that made the table has to be named.
          builtBy: builtByFor("collection", c.builderOwned),
          status: c.status === true,
          localized: (c as { localized?: boolean }).localized === true,
        }
      );
      out[c.tableName] = table;
    }
    // Singles (single_* tables) use identical field/column logic to
    // collections; include them so drizzle-kit sees the full desired schema.
    for (const s of Object.values(desired.singles)) {
      // Why: same status + localized forwarding rationale as the collection
      // branch above — keep the drizzle-kit and Nextly views in lockstep for
      // singles too (a localized single also stores translatable fields in its
      // companion `single_<slug>_locales` table, not on the main table).
      const { table } = generateRuntimeSchema(
        s.tableName,
        s.fields as unknown as Parameters<typeof generateRuntimeSchema>[1],
        dialect,
        {
          // Rendered as DDL by drizzle-kit, so the builder that made it is named here too.
          builtBy: builtByFor("single", s.builderOwned),
          status: s.status === true,
          localized: (s as { localized?: boolean }).localized === true,
        }
      );
      out[s.tableName] = table;
    }
    // Components (comp_* tables) use component system columns
    // (_parent_id, _parent_table, _parent_field, _order, _component_type)
    // instead of collection columns (title, slug). FieldGroupSchemaService
    // owns that column layout; generateRuntimeSchema would inject wrong
    // system columns.
    const fieldGroupSchemaService = new FieldGroupSchemaService(dialect);
    for (const c of Object.values(desired.components)) {
      // i18n: omit a localized component's translatable columns from the main
      // comp_ table handed to drizzle-kit (they live in comp_<slug>_locales,
      // provisioned out-of-band) — same rule as collections/singles above.
      const componentTable = fieldGroupSchemaService.generateRuntimeSchema(
        c.tableName,
        c.fields,
        {
          localized: (c as { localized?: boolean }).localized === true,
          // 🔴 The discriminator is a SYSTEM column whose name no user ever
          // chooses: the only two spellings are the two storage generations,
          // and which one a table carries is a fact of that table rather than a
          // preference the desired shape could hold an opinion about. Naming
          // the other one turns a diff into "add this column, drop that one" —
          // a destructive pair the classifier refuses and fresh-push strips, so
          // every later apply carries an operation that can never succeed.
          //
          // A table the catalog does not describe, including one about to be
          // created, resolves to the spelling this release's DDL writes.
          typeColumn:
            typeColumns.get(c.tableName) ?? STORAGE_FORMAT.columns.type,
        }
      );
      out[c.tableName] = componentTable;
    }
    return out;
  }

  private async importDrizzleKit(
    dialect: SupportedDialect,
    databaseName: string | undefined
  ): Promise<DrizzleKitLike> {
    const { getPgDrizzleKit, getMySQLDrizzleKit, getSQLiteDrizzleKit } =
      await import("../../../database/drizzle-kit-lazy");

    switch (dialect) {
      case "postgresql": {
        const kit = await getPgDrizzleKit();
        return {
          // PG's v1 pushSchema takes a named entities filter (replaces the
          // pre-v1 positional schemaFilters/tablesFilter args). Scoping the
          // introspection to the desired tables prevents the kit's differ
          // from pairing out-of-scope live tables as phantom renames —
          // which on v1 throws its resolver's HintsHandler internal error.
          pushSchema: (schema, db, tablesFilter) =>
            kit.pushSchema(schema, db, {
              schemas: ["public"],
              tables: tablesFilter,
            }),
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
          // MySQL drizzle-kit upstream takes (schema, db, databaseName) —
          // no tablesFilter slot. Discard the arg here; the post-emission
          // filterUnsafeStatements is the data-loss safeguard.
          pushSchema: (schema, db) => kit.pushSchema(schema, db, databaseName),
        };
      }
      case "sqlite": {
        const kit = await getSQLiteDrizzleKit();
        return {
          // SQLite drizzle-kit upstream takes only (schema, db) — no
          // tablesFilter. Same caveat as MySQL.
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
    // Before the DDL branch: nothing ran, and saying so is the whole value of the distinction.
    if (NextlyError.isValidation(err)) return "PRECONDITION_FAILED";
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
