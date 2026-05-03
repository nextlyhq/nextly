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

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import { RealClassifier } from "./classifier/classifier";
import {
  countNulls as countNullsHelper,
  countRows as countRowsHelper,
} from "./classifier/count-helpers";
import {
  buildDesiredTableFromComponentFields,
  buildDesiredTableFromFields,
} from "./diff/build-from-fields";
import { diffSnapshots } from "./diff/diff";
import { introspectLiveSnapshot } from "./diff/introspect-live";
import type { NextlySchemaSnapshot, Operation } from "./diff/types";
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
  const { desired, db, dialect } = args;
  const renameDetector = deps.renameDetector ?? new RegexRenameDetector();
  const classifier = deps.classifier ?? new RealClassifier();
  const introspect = deps.introspect ?? introspectLiveSnapshot;

  // Phase A: introspect live + build desired snapshot + diff.
  // Iterates all three buckets: collections, singles, and components.
  // Singles use the same system columns as collections (id, title, slug,
  // created_at, updated_at). Components use a separate builder that injects
  // component system columns (_parent_id, _parent_table, etc.) instead.
  const managedTableNames = [
    ...Object.values(desired.collections).map(c => c.tableName),
    ...Object.values(desired.singles).map(s => s.tableName),
    ...Object.values(desired.components).map(c => c.tableName),
  ];

  const liveSnapshot = await introspect(db, dialect, managedTableNames);

  const collectionTables = Object.values(desired.collections).map(c =>
    buildDesiredTableFromFields(
      c.tableName,
      c.fields as unknown as Parameters<typeof buildDesiredTableFromFields>[1],
      dialect
    )
  );
  const singleTables = Object.values(desired.singles).map(s =>
    buildDesiredTableFromFields(
      s.tableName,
      s.fields as unknown as Parameters<typeof buildDesiredTableFromFields>[1],
      dialect
    )
  );
  const componentTables = Object.values(desired.components).map(c =>
    buildDesiredTableFromComponentFields(
      c.tableName,
      c.fields as unknown as Parameters<typeof buildDesiredTableFromComponentFields>[1],
      dialect
    )
  );
  const desiredSnapshot: NextlySchemaSnapshot = {
    tables: [...collectionTables, ...singleTables, ...componentTables],
  };

  const operations = diffSnapshots(liveSnapshot, desiredSnapshot);

  // Phase B: rename detection + classification.
  // The rename detector reads typed Operation[] (post Option E) and
  // emits one candidate per drop+add pair on each table.
  const candidates = renameDetector.detect(operations, dialect);

  // Classifier produces ClassifierEvent[] for interactive cases
  // (NOT-NULL-with-nulls, required-no-default, type changes). Count
  // callbacks are bound to the live DB so RealClassifier can populate
  // event row counts; tests inject stubs that return zero.
  const classificationResult = await classifier.classify({
    operations,
    drizzleWarnings: [],
    hasDataLoss: false,
    countNulls: (table, column) => countNullsHelper(db, dialect, table, column),
    countRows: table => countRowsHelper(db, dialect, table),
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
