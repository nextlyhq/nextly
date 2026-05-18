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

import { getDialectTables } from "../../../database/index";
import {
  getCachedSnapshot,
  getLiveSnapshot,
  setCachedSnapshot,
} from "../../../init/schema-snapshot-cache";
import { buildNotificationEvent } from "../../../runtime/notifications/build-event";
import type { MigrationScope } from "../../../runtime/notifications/types";
import { ComponentSchemaService } from "../../components/services/component-schema-service";
import { generateRuntimeSchema } from "../services/runtime-schema-generator";

import {
  countNulls as countNullsHelper,
  countRows as countRowsHelper,
} from "./classifier/count-helpers";
import { canEmitWithoutDrizzleKit, emitDdl } from "./ddl-emitter";
import {
  buildDesiredTableFromFields,
  buildDesiredTableFromComponentFields,
} from "./diff/build-from-fields";
import { diffSnapshots } from "./diff/diff";
import { introspectLiveSnapshot } from "./diff/introspect-live";
import type { Operation, NextlySchemaSnapshot } from "./diff/types";
import { MANAGED_TABLE_PREFIXES_REGEX, isManagedTable } from "./managed-tables";
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

// Shape of drizzle-kit's pushSchema return value.
interface PushSchemaPassResult {
  statementsToExecute: string[];
  warnings: string[];
  hasDataLoss: boolean;
}

interface DrizzleKitLike {
  // Phase C (2026-05-01): added optional tablesFilter so PG pushSchema
  // can scope drizzle-kit's internal introspection to only the desired
  // tables. Without this, drizzle-kit walks the full live DB and emits
  // DROP TABLE for any managed table absent from the partial pipeline
  // desired schema (boot-time sync only knows code-first collections,
  // so admin-UI tables get DROPped). SQLite/MySQL drizzle-kit upstream
  // does NOT accept tablesFilter — those branches discard it. The
  // post-emission `filterUnsafeStatements` is the second line of
  // defense and the ONLY defense for SQLite/MySQL until upstream adds
  // tablesFilter or we move to generateMigration.
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
const ORPHAN_DROP_PATTERNS: ReadonlyArray<{
  kind: "SEQUENCE" | "INDEX";
  re: RegExp;
}> = [
  {
    kind: "SEQUENCE",
    re: /^DROP\s+SEQUENCE\s+(?:IF\s+EXISTS\s+)?(?:["`]?\w+["`]?\.)?["`]?(\w+)["`]?/i,
  },
  {
    kind: "INDEX",
    re: /^DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:["`]?\w+["`]?\.)?["`]?(\w+)["`]?/i,
  },
];

// Gated debug log for which route (`useFastPath`) the apply took. Operators
// set DEBUG_SCHEMA=1 to enable both this and drizzle-kit's chatter inside
// withCapturedStdout. The non-additive enumeration on the fallback path
// makes "why didn't the fast path trigger?" trivially answerable in support.
function logApplyRoute(useFastPath: boolean, ops: Operation[]): void {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
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
              // column when Draft/Published is enabled.
              { hasStatus: c.status === true }
            )
          ),
          ...Object.values(desired.singles).map(s =>
            buildDesiredTableFromFields(
              s.tableName,
              s.fields as unknown as Parameters<
                typeof buildDesiredTableFromFields
              >[1],
              dialect,
              { hasStatus: s.status === true }
            )
          ),
          ...Object.values(desired.components).map(c =>
            buildDesiredTableFromComponentFields(
              c.tableName,
              c.fields as unknown as Parameters<
                typeof buildDesiredTableFromComponentFields
              >[1],
              dialect
            )
          ),
        ],
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

      const resolvedOps =
        this.testHooks._resolvedOpsOverride ??
        applyResolutionsToOperations(
          operations,
          toRenameResolutions(dispatchResult.confirmedRenames, candidates)
        );

      // Phase C+D: execute pre-resolution ops, then pushSchema for the rest.
      const drizzleSchema = this.testHooks._buildDrizzleSchemaOverride
        ? this.testHooks._buildDrizzleSchemaOverride(patchedDesired, dialect)
        : this.buildDrizzleSchema(patchedDesired, dialect);

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

      const scopedSchema: Record<string, unknown> = {};
      for (const [tableName, tableObj] of Object.entries(drizzleSchema)) {
        if (affectedTableNames.has(tableName)) {
          scopedSchema[tableName] = tableObj;
        }
      }
      // Empty-schema safety net. Fires when resolvedOps contains only
      // drop_table entries (already applied by pre-resolution; their
      // tables aren't in patchedDesired anyway), or when a future op
      // kind escapes the switch above without contributing to the set.
      // Passing nothing to drizzle-kit would be a contract violation.
      const effectiveDrizzleSchema =
        Object.keys(scopedSchema).length > 0 ? scopedSchema : drizzleSchema;

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
        if (useFastPath) {
          emittedStatements = emitDdl(resolvedOps, dialect);
        } else {
          let pushResult: PushSchemaPassResult;
          try {
            // withCapturedStdout reroutes any chatter drizzle-kit writes to
            // process.stdout/stderr so it doesn't leak into the dev console.
            // The sink only forwards when DEBUG_SCHEMA=1 — see
            // stdout-capture.ts for the scope-caveat (sync-return path).
            pushResult = await withCapturedStdout(
              () =>
                kit.pushSchema(effectiveDrizzleSchema, tx, desiredTableNames),
              // eslint-disable-next-line turbo/no-undeclared-env-vars
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
          emittedStatements = pushResult.statementsToExecute;
        }
        const safe = this.filterUnsafeStatements(
          emittedStatements,
          desiredTableNames
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

  private filterUnsafeStatements(
    statements: string[],
    desiredTableNames: string[]
  ): string[] {
    // Phase 6 follow-up (2026-05-01): the original Phase C strict
    // block-all-DROPs rule turned out too aggressive — it broke
    // SQLite's table-rebuild pattern.
    //
    // SQLite can't ALTER COLUMN type, so drizzle-kit emits a
    // CREATE/COPY/DROP/RENAME sequence for type changes (renames
    // included):
    //   1. CREATE TABLE __new_dc_job (...)
    //   2. INSERT INTO __new_dc_job SELECT ... FROM dc_job
    //   3. DROP TABLE dc_job          ← intentional, NOT accidental
    //   4. ALTER TABLE __new_dc_job RENAME TO dc_job
    //
    // The original strict filter blocked step 3, so step 4 then
    // failed with "table dc_job already exists". Result: the rename
    // never completed; the dynamic_collections.fields JSON updated
    // to the new name but the actual column kept the old name; every
    // subsequent query against the collection failed with "no such
    // column".
    //
    // Refined rule:
    //   - DROP TABLE for tables IN the desired schema → ALLOW
    //     (drizzle-kit's emit is part of an intentional rebuild —
    //     the table will be recreated by a subsequent CREATE/RENAME)
    //   - DROP TABLE for tables NOT in the desired schema → BLOCK
    //     (drizzle-kit thinks it's orphaned — original Phase C
    //     scenario where boot-time partial desired would otherwise
    //     destroy admin-UI tables)
    //
    // The Phase C goal — preventing accidental drops of admin-UI
    // tables on restart — is preserved because such tables are not
    // in the boot-path's partial desired schema and therefore still
    // hit the BLOCK branch. PR #118's "include system tables in
    // desired" change makes system tables hit the ALLOW branch
    // (their DROPs during rebuilds are now intended).
    //
    // The same policy extends to DROP SEQUENCE and DROP INDEX.
    // drizzle-kit's `tablesFilter` restricts which TABLES it inspects but
    // does NOT suppress its emission of DROP SEQUENCE / DROP INDEX for
    // "orphan" objects whose owner table isn't in the scoped schema —
    // e.g. when desired = {posts, categories, tags} but the live DB has
    // `accounts_id_seq`, drizzle-kit emits `DROP SEQUENCE accounts_id_seq`,
    // which then fails with PG 2BP01 because `accounts.id` still depends
    // on it. We infer the owner table from the object name using PG's
    // default naming conventions:
    //   SERIAL / IDENTITY sequences: `<table>_<col>_seq`
    //   Indexes:                     `<table>_<col(s)>_{idx|key|pkey|unique}`
    // Custom-named objects that don't share a prefix with any managed
    // table can't be safely identified — block + warn (fail-safe). The
    // operator can drop such objects manually before re-running if the
    // block proves a false positive.
    const desiredSet = new Set(desiredTableNames.map(t => t.toLowerCase()));

    return statements.filter(stmt => {
      // ── DROP TABLE ──────────────────────────────────────────────────
      const dropMatch = stmt.match(
        /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:["`]?\w+["`]?\.)?["`]?(\w+)["`]?/i
      );
      if (dropMatch) {
        const tableName = dropMatch[1] ?? "<unknown>";
        const isInDesired = desiredSet.has(tableName.toLowerCase());

        if (isInDesired) {
          // Intentional drop — rebuild pattern, system-table refresh,
          // etc. Pass through and let executor run it.
          return true;
        }

        // Accidental drop — table not in desired schema. Block and
        // log so operators see the protection.
        console.warn(
          `[Nextly schema] Blocked DROP TABLE "${tableName}" emitted by ` +
            `drizzle-kit pushSchema (table not in current desired schema). ` +
            `If this drop was intentional, route it through the ` +
            `pre-resolution executor with explicit user confirmation. ` +
            `(managed=${isManagedTable(tableName)})`
        );
        return false;
      }

      // ── DROP SEQUENCE / DROP INDEX ───────────────────────────────────
      // Block when the inferred owner table is not in desiredSet
      // (longest-prefix match — see inferOwnerTableFromObjectName).
      // A matched owner means the drop is intentional (SERIAL rebuild
      // during a type migration; index rebuild after a column change).
      for (const { kind, re } of ORPHAN_DROP_PATTERNS) {
        const m = stmt.match(re);
        if (!m) continue;
        const objectName = m[1] ?? "";
        if (
          this.inferOwnerTableFromObjectName(objectName, desiredSet) !== null
        ) {
          return true;
        }
        console.warn(
          `[Nextly schema] Blocked DROP ${kind} "${objectName}" emitted by ` +
            `drizzle-kit pushSchema (owner table not in current desired ` +
            `schema or name is non-conventional). If this drop was ` +
            `intentional, route it through the pre-resolution executor ` +
            `with explicit user confirmation, or drop it manually before ` +
            `re-running if the ${kind.toLowerCase()} name is custom.`
        );
        return false;
      }

      // ── Everything else passes through ──────────────────────────────
      return true;
    });
  }

  /**
   * Infers the owner table of a sequence or index from its name using
   * Postgres's default naming conventions:
   *   - SERIAL / IDENTITY sequences: `<table>_<col>_seq`
   *   - Indexes:                      `<table>_<col(s)>_idx | _key | _pkey | _unique`
   *
   * Strategy: walk underscore-delimited prefixes from longest to shortest
   * and return the first candidate found in `desiredSet`. Longest-first
   * ensures that multi-word table names like `email_templates` are
   * preferred over the shorter prefix `email`.
   *
   * Examples:
   *   accounts_id_seq          → "accounts"        (if in desiredSet)
   *   email_templates_id_seq   → "email_templates" (if in desiredSet)
   *   dc_posts_title_idx       → "dc_posts"        (if in desiredSet)
   *   idx_completely_custom    → null              (no prefix matches)
   *
   * Returns the matched table name (lowercased) or `null` if no prefix
   * in `desiredSet` was found. A `null` result means we can't identify
   * the owner, and the caller should treat the statement as unsafe.
   */
  private inferOwnerTableFromObjectName(
    objectName: string,
    desiredSet: ReadonlySet<string>
  ): string | null {
    const lower = objectName.toLowerCase();
    const parts = lower.split("_");
    // Walk from the longest prefix down to a single part.
    for (let i = parts.length - 1; i > 0; i--) {
      const candidate = parts.slice(0, i).join("_");
      if (desiredSet.has(candidate)) return candidate;
    }
    return null;
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
      getDialectTables(dialect)
    )) {
      if (this.isDrizzleTable(value)) {
        const sqlName = this.getDrizzleTableName(value, exportKey);
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
      const { table } = generateRuntimeSchema(
        c.tableName,
        c.fields as unknown as Parameters<typeof generateRuntimeSchema>[1],
        dialect,
        { status: c.status === true }
      );
      out[c.tableName] = table;
    }
    // Singles (single_* tables) use identical field/column logic to
    // collections; include them so drizzle-kit sees the full desired schema.
    for (const s of Object.values(desired.singles)) {
      // Why: same status forwarding rationale as the collection branch
      // above — keep the drizzle-kit and Nextly views in lockstep for
      // singles too.
      const { table } = generateRuntimeSchema(
        s.tableName,
        s.fields as unknown as Parameters<typeof generateRuntimeSchema>[1],
        dialect,
        { status: s.status === true }
      );
      out[s.tableName] = table;
    }
    // Components (comp_* tables) use component system columns
    // (_parent_id, _parent_table, _parent_field, _order, _component_type)
    // instead of collection columns (title, slug). ComponentSchemaService
    // owns that column layout; generateRuntimeSchema would inject wrong
    // system columns.
    const componentSchemaService = new ComponentSchemaService(dialect);
    for (const c of Object.values(desired.components)) {
      const componentTable = componentSchemaService.generateRuntimeSchema(
        c.tableName,
        c.fields
      );
      out[c.tableName] = componentTable;
    }
    return out;
  }

  // Phase 6 follow-up: cheap structural check for Drizzle tables.
  // Mirrors SchemaRegistry.isDrizzleTable but inlined to avoid
  // pulling SchemaRegistry's DI graph into the pipeline module.
  private isDrizzleTable(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    // Drizzle tables carry Symbol.for("drizzle:Name") — the simplest
    // stable cross-dialect check.
    return Symbol.for("drizzle:Name") in value;
  }

  // Phase 6 follow-up: extract a Drizzle table's SQL name.
  private getDrizzleTableName(value: unknown, fallback: string): string {
    const named = (value as Record<symbol, unknown>)[
      Symbol.for("drizzle:Name")
    ];
    return typeof named === "string" ? named : fallback;
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
          // PG drizzle-kit accepts tablesFilter (4th arg) — pass through
          // so introspection is scoped to just the current pipeline's
          // desired tables. Eliminates spurious DROP TABLE / RENAME
          // emissions for managed tables outside the pipeline's scope.
          pushSchema: (schema, db, tablesFilter) =>
            kit.pushSchema(schema, db, ["public"], tablesFilter),
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
