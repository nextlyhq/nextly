// Read-only preview entry point for the schema apply pipeline.
//
// Runs Phase A (introspect live -> diff) + Phase B (rename detect +
// classify) of `PushSchemaPipeline.apply` without applying any DDL,
// dispatching any prompts, or writing to the migration journal.
//
// F8 PR 3 added this as a first-class pipeline export so:
//   - The admin UI's `/preview` endpoint can compute pipeline-shape
//     output (typed Operation[] + ClassifierEvent[]) and translate it
//     to the legacy `SchemaPreviewResult` for backwards compat.
//   - F10 (browser modals + SSE) can show "what would change" before
//     the user confirms, reusing the same diff/classify code path.
//   - F11 (migration files CLI) can materialise the diff into .sql
//     files without ever touching the live DB beyond introspection.
//
// By construction this function:
//   - Does NOT take a PromptDispatcher dep (no decisions to make).
//   - Does NOT take an executor / journal / pre-rename / pre-cleanup
//     dep (nothing to execute).
//   - Returns the live snapshot so callers can compute per-field row
//     counts (the legacy translator needs this for `removed[].rowCount`).

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { getActiveExtensionSchema } from "../extension/build-extension-schema";

import { RealClassifier } from "./classifier/classifier";
import {
  countLongerThan as countLongerThanHelper,
  countNulls as countNullsHelper,
  countRows as countRowsHelper,
} from "./classifier/count-helpers";
import {
  buildDesiredSnapshot,
  desiredSchemaTableNames,
} from "./desired-snapshot";
import { diffSnapshots } from "./diff/diff";
import { introspectLiveSnapshot } from "./diff/introspect-live";
import type { NextlySchemaSnapshot, Operation } from "./diff/types";
import { operationsToJudge, planCompanionMoves } from "./moved-to-companion";
import {
  excludeLockedTableOps,
  logSkippedLockedOps,
} from "./pushschema-pipeline";
import type {
  Classifier,
  ClassificationLevel,
  RenameCandidate,
  RenameDetector,
} from "./pushschema-pipeline-interfaces";
import { RegexRenameDetector } from "./rename-detector";
import type { ClassifierEvent } from "./resolution/types";
import type { DesiredSchema } from "./types";

// Result of a preview-mode pipeline run. Mirrors the readable subset of
// PushSchemaPipeline's internal state without exposing apply-only fields.
export interface PipelinePreviewResult {
  // Typed diff: every change between live and desired as an Operation.
  // The translator maps these to legacy `changes.{added,removed,changed}`.
  operations: Operation[];

  // Interactive / warning events emitted by the classifier. Each event
  // describes a user-visible decision point with applicable resolutions
  // (4-kind union) or a per-dialect warning string.
  events: ClassifierEvent[];

  // Drop+add pairs the rename detector identified as possible renames.
  // The translator forwards these to the dialog as `renamed[]`.
  candidates: RenameCandidate[];

  // Overall severity level. The translator maps this to legacy
  // `classification`/`hasDestructiveChanges`.
  classification: ClassificationLevel;

  // The introspected live state, exposed so callers can run their own
  // queries against it without re-introspecting (the legacy translator
  // uses this to count rows on dropped fields).
  liveSnapshot: NextlySchemaSnapshot;
}

// Optional deps for testing. Production callers omit and get the real
// classifier + RegexRenameDetector by default. The `introspect` seam
// matches the `_introspectSnapshotOverride` test hook in
// PushSchemaPipeline so unit tests can stub the live DB.
export interface PreviewDesiredSchemaDeps {
  renameDetector?: RenameDetector;
  classifier?: Classifier;
  introspect?: (
    db: unknown,
    dialect: SupportedDialect,
    tableNames: string[]
  ) => Promise<NextlySchemaSnapshot>;
}

export interface PreviewDesiredSchemaArgs {
  desired: DesiredSchema;
  db: unknown;
  dialect: SupportedDialect;
  /** As the apply's own (`PushSchemaPipeline.apply`), so the preview asks what the apply will. */
  defaultLocale?: string;
}

/**
 * Run Phase A (diff) + Phase B (classify) of the apply pipeline against
 * a desired schema, without applying. Read-only over the live DB
 * (introspection + classifier counts only — no DDL, no UPDATE).
 *
 * Mirrors `PushSchemaPipeline.apply()` lines 250-296 with the post-
 * classifier dispatch + apply phases removed.
 */
export async function previewDesiredSchema(
  args: PreviewDesiredSchemaArgs,
  deps: PreviewDesiredSchemaDeps = {}
): Promise<PipelinePreviewResult> {
  const { db, dialect } = args;
  // Resolved once, here, so the snapshot this function builds and the DDL the apply path builds
  // from the same declaration describe the same column. Two different builders read a desired
  // schema, and normalising what they share is what keeps them from disagreeing forever.
  const desired = args.desired;
  const renameDetector = deps.renameDetector ?? new RegexRenameDetector();
  const classifier = deps.classifier ?? new RealClassifier();
  const introspect = deps.introspect ?? introspectLiveSnapshot;

  // Phase A: introspect live + build desired snapshot + diff.
  //
  // The apply's own table list and snapshot builder, with the extension
  // schema the apply merges: the tables plugins and the app declare, and what
  // hooks contribute to entity tables. Built from the entities alone, the
  // preview showed a contributed column as one to drop and a declared table
  // as one to create, which the apply never does.
  const extensions = getActiveExtensionSchema(dialect);
  const liveSnapshot = await introspect(
    db,
    dialect,
    desiredSchemaTableNames(desired, extensions)
  );
  const { snapshot: desiredSnapshot } = buildDesiredSnapshot({
    desired,
    dialect,
    liveSnapshot,
    extensions,
  });

  const allOperations = diffSnapshots(liveSnapshot, desiredSnapshot);

  // Preview is what the browser asks the operator to confirm, so it must show the operation set the
  // apply can actually run. The apply drops operations on code-first and plugin-owned tables before
  // it reads them; leaving them in here surfaced destructive warnings and rename prompts for drift
  // on a table the save does not own and would never have touched.
  const { kept: operations, skipped } = excludeLockedTableOps(
    allOperations,
    desired
  );
  logSkippedLockedOps(skipped);

  // Phase B: rename detection + classification.
  // The rename detector reads typed Operation[] (post Option E) and
  // emits one candidate per drop+add pair on each table.
  // The same moves the apply plans, so a drop it will not ask about is not asked about here.
  const { moved } = await planCompanionMoves(
    desired,
    operations,
    args.db,
    dialect,
    args.defaultLocale
  );
  const judged = operationsToJudge(operations, moved);
  const candidates = renameDetector.detect(judged, dialect);

  // Classifier produces ClassifierEvent[] for interactive cases
  // (NOT-NULL-with-nulls, required-no-default, type changes). Count
  // callbacks are bound to the live DB so RealClassifier can populate
  // event row counts; tests inject stubs that return zero.
  const classificationResult = await classifier.classify({
    operations: judged,
    countNulls: (table, column) => countNullsHelper(db, dialect, table, column),
    countRows: table => countRowsHelper(db, dialect, table),
    countLongerThan: (table, column, length) =>
      countLongerThanHelper(db, dialect, table, column, length),
    dialect,
  });

  return {
    operations,
    events: classificationResult.events,
    candidates,
    classification: classificationResult.level,
    liveSnapshot,
  };
}
